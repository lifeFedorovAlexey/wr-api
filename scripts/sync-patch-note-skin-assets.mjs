import "dotenv/config";

import { and, eq, inArray } from "drizzle-orm";

import { client, db } from "../db/client.js";
import { champions, patchNoteChanges } from "../db/schema.js";
import { extractRiotSkinImageSource, enrichPatchSkinImages } from "../lib/patchSkinImages.mjs";
import {
  buildGuideAssetKey,
  buildGuideAssetStorageKey,
  buildPublicGuideAssetPath,
  createGuideAssetStore,
} from "../lib/guideAssets.mjs";
import { createObjectStorageClient, shouldUseS3PublicUrls } from "../lib/objectStorage.mjs";

const DEFAULT_PATCH_LIMIT = 20;
const MAX_PATCH_LIMIT = 20;

function parseOptions(argv) {
  const options = {
    apply: false,
    updateDatabase: false,
    patchVersions: [],
    patchLimit: DEFAULT_PATCH_LIMIT,
    mirrorApiOrigin: null,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") options.apply = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--update-db") options.updateDatabase = true;
    else if (arg.startsWith("--versions=")) {
      options.patchVersions = arg.slice("--versions=".length).split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    } else if (arg.startsWith("--limit=")) {
      options.patchLimit = Math.min(MAX_PATCH_LIMIT, Math.max(1, Number(arg.slice("--limit=".length)) || DEFAULT_PATCH_LIMIT));
    } else if (arg.startsWith("--mirror-api-origin=")) {
      options.mirrorApiOrigin = arg.slice("--mirror-api-origin=".length).trim().replace(/\/+$/, "");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.updateDatabase && !options.apply) throw new Error("--update-db requires --apply");
  for (const version of options.patchVersions) {
    if (!/^\d+\.\d+[a-z]?$/.test(version)) throw new Error(`Invalid patch version: ${version}`);
  }
  if (options.mirrorApiOrigin) validateMirrorApiOrigin(options.mirrorApiOrigin);
  return options;
}

function validateMirrorApiOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Mirror API origin must use HTTPS");
  }
}

async function loadPatchVersions(options) {
  const rows = await client`
    select patch_version
    from patch_notes
    where parse_status = 'parsed'
    group by patch_version
    order by max(published_at) desc nulls last
    limit ${MAX_PATCH_LIMIT}
  `;
  const allowlist = rows.map((row) => row.patch_version);
  if (options.patchVersions.length) {
    const outsideAllowlist = options.patchVersions.filter((version) => !allowlist.includes(version));
    if (outsideAllowlist.length) throw new Error(`Patch versions outside latest ${MAX_PATCH_LIMIT} allowlist: ${outsideAllowlist.join(", ")}`);
    return options.patchVersions;
  }
  return allowlist.slice(0, options.patchLimit);
}

async function loadSkinRows(versions) {
  if (!versions.length) return [];
  return db.select({
    id: patchNoteChanges.id,
    patchVersion: patchNoteChanges.patchVersion,
    locale: patchNoteChanges.locale,
    entitySlug: patchNoteChanges.entitySlug,
    entityName: patchNoteChanges.entityName,
    imageUrl: patchNoteChanges.imageUrl,
  }).from(patchNoteChanges).where(and(
    eq(patchNoteChanges.entityKind, "skin"),
    inArray(patchNoteChanges.patchVersion, versions),
  ));
}

function findChampionSlug(skinSlug, championSlugs) {
  return championSlugs
    .filter((slug) => skinSlug === slug || skinSlug.startsWith(`${slug}-`))
    .sort((left, right) => right.length - left.length)[0] || null;
}

async function resolveSkinSources(rows) {
  const championRows = await db.select({ slug: champions.slug }).from(champions);
  const championSlugs = championRows.map((row) => row.slug);
  const withStoredSources = rows.map((row) => ({
    ...row,
    entityKind: "skin",
    sourceChampionSlug: findChampionSlug(String(row.entitySlug || ""), championSlugs),
    sourceImageUrl: extractRiotSkinImageSource(row.imageUrl),
  }));
  return enrichPatchSkinImages(withStoredSources);
}

function buildAssetTasks(rows) {
  const tasksByKey = new Map();
  const missingSourceRows = [];
  for (const row of rows) {
    const sourceUrl = extractRiotSkinImageSource(row.sourceImageUrl);
    if (!sourceUrl || !row.entitySlug) {
      missingSourceRows.push(row);
      continue;
    }
    const assetKey = buildGuideAssetKey("patch", "skin", row.entitySlug, "image");
    const task = tasksByKey.get(assetKey) || { assetKey, sourceUrl, rows: [] };
    if (task.sourceUrl !== sourceUrl) {
      task.sourceConflicts = Array.from(new Set([...(task.sourceConflicts || [task.sourceUrl]), sourceUrl]));
    }
    task.rows.push(row);
    tasksByKey.set(assetKey, task);
  }
  return { tasks: Array.from(tasksByKey.values()), missingSourceRows };
}

function publicImageUrl(task, mirrorApiOrigin) {
  if (mirrorApiOrigin) {
    return `${mirrorApiOrigin}/assets/${encodeURIComponent(task.assetKey)}?src=${encodeURIComponent(task.sourceUrl)}`;
  }
  return buildPublicGuideAssetPath(task.assetKey, task.sourceUrl);
}

async function mirrorThroughApi(task, mirrorApiOrigin) {
  const url = publicImageUrl(task, mirrorApiOrigin);
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Mirror API returned HTTP ${response.status}`);
}

async function mirrorThroughStorage(task, objectStorage, guideAssetStore) {
  const storageKey = buildGuideAssetStorageKey(task.assetKey, task.sourceUrl);
  if (await objectStorage.objectExists(storageKey)) return { storageKey, alreadyExists: true };
  await guideAssetStore.mirror(task.assetKey, task.sourceUrl);
  if (!(await objectStorage.objectExists(storageKey))) throw new Error(`S3 object missing after mirror: ${storageKey}`);
  return { storageKey, alreadyExists: false };
}

async function updateRows(rows, imageUrl) {
  await client.begin(async (transaction) => {
    for (const row of rows) {
      await transaction`
        update patch_note_changes
        set image_url = ${imageUrl}, updated_at = now()
        where id = ${row.id}
      `;
    }
  });
}

async function prepareRun(options) {
  const versions = await loadPatchVersions(options);
  const storedRows = await loadSkinRows(versions);
  const resolvedRows = await resolveSkinSources(storedRows);
  const { tasks, missingSourceRows } = buildAssetTasks(resolvedRows);
  const objectStorage = options.apply && !options.mirrorApiOrigin
    ? createObjectStorageClient(process.env)
    : null;

  if (options.apply && !options.mirrorApiOrigin && !objectStorage) {
    throw new Error("S3 config is required for local mirror mode; pass --mirror-api-origin to trigger the application mirror endpoint");
  }

  const guideAssetStore = objectStorage
    ? await createGuideAssetStore(process.env, { objectStorage, throwOnMirrorError: true })
    : null;
  return { versions, storedRows, tasks, missingSourceRows, objectStorage, guideAssetStore };
}

function createSummary(options, run) {
  const sourceConflicts = run.tasks.filter((task) => task.sourceConflicts?.length);
  return {
    mode: options.apply ? options.mirrorApiOrigin ? "remote-api-mirror" : "s3-mirror" : "dry-run",
    updateDatabase: options.updateDatabase,
    s3PublicMode: shouldUseS3PublicUrls(process.env),
    versions: run.versions,
    sourceRows: run.storedRows.length,
    uniqueAssets: run.tasks.length,
    mirrored: [],
    alreadyExists: [],
    sourceConflicts: sourceConflicts.map(({ assetKey, sourceUrl, sourceConflicts: urls }) => ({ assetKey, sources: urls || [sourceUrl] })),
    missingSourceRows: run.missingSourceRows.map((row) => ({ patchVersion: row.patchVersion, locale: row.locale, entitySlug: row.entitySlug, entityName: row.entityName })),
    failed: [],
  };
}

async function processAssetTask(task, options, run, summary) {
  if (task.sourceConflicts?.length) return;
  const imageUrl = publicImageUrl(task, options.mirrorApiOrigin);
  const databaseImageUrl = imageUrl;
  try {
    if (!options.apply) {
      console.log(`[patch-skin-assets] ${task.assetKey} <= ${task.sourceUrl} -> ${databaseImageUrl}`);
      return;
    }

    const result = options.mirrorApiOrigin
      ? (await mirrorThroughApi(task, options.mirrorApiOrigin), null)
      : await mirrorThroughStorage(task, run.objectStorage, run.guideAssetStore);
    if (result?.alreadyExists) summary.alreadyExists.push({ assetKey: task.assetKey, storageKey: result.storageKey });
    else if (result) summary.mirrored.push({ assetKey: task.assetKey, storageKey: result.storageKey });
    else summary.mirrored.push({ assetKey: task.assetKey, mirrorUrl: imageUrl });
    if (options.updateDatabase) await updateRows(task.rows, databaseImageUrl);
  } catch (error) {
    summary.failed.push({ assetKey: task.assetKey, error: error instanceof Error ? error.message : String(error) });
  }
}

async function main() {
  const options = parseOptions(process.argv);
  const run = await prepareRun(options);
  const summary = createSummary(options, run);
  console.log(`[patch-skin-assets] ${summary.mode}: versions=${run.versions.join(",") || "none"} rows=${run.storedRows.length} assets=${run.tasks.length}`);
  for (const task of run.tasks) await processAssetTask(task, options, run, summary);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed.length || summary.sourceConflicts.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[patch-skin-assets] failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
