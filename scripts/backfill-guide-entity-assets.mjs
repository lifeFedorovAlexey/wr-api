import "dotenv/config";

import { client, db } from "../db/client.js";
import { guideEntities } from "../db/schema.js";
import { buildGuideAssetKey, createGuideAssetStore } from "../lib/guideAssets.mjs";
import { createObjectStorageClient, shouldUseS3PublicUrls } from "../lib/objectStorage.mjs";

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dryRun: false,
    force: false,
    requireS3: false,
    slugs: [],
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--require-s3") {
      options.requireS3 = true;
      continue;
    }

    options.slugs.push(String(arg || "").trim().toLowerCase());
  }

  return options;
}

function buildTasks(rows, options) {
  const tasks = [];

  for (const row of rows) {
    const slug = String(row?.slug || "").trim().toLowerCase();
    if (!slug) continue;
    if (options.slugs.length && !options.slugs.includes(slug)) continue;

    const kind = String(row?.kind || "").trim();

    if (row?.imageUrl) {
      tasks.push({
        kind,
        slug,
        field: "image",
        sourceUrl: String(row.imageUrl).trim(),
        assetKey: buildGuideAssetKey("guide", kind, slug, "image"),
      });
    }

    if (row?.tooltipImageUrl) {
      tasks.push({
        kind,
        slug,
        field: "tooltip",
        sourceUrl: String(row.tooltipImageUrl).trim(),
        assetKey: buildGuideAssetKey("guide", kind, slug, "tooltip"),
      });
    }
  }

  return tasks;
}

function logProgress({ index, total, task, outcome, mirrored, skipped, failed }) {
  console.log(
    `[backfill-guide-entity-assets] ${index}/${total} ${task.kind}:${task.slug}:${task.field} -> ${outcome} | mirrored=${mirrored} skipped=${skipped} failed=${failed}`,
  );
}

async function main() {
  const options = parseCliArgs(process.argv);
  const objectStorage = createObjectStorageClient(process.env);
  const guideAssetStore = await createGuideAssetStore(process.env);
  const useS3 = Boolean(objectStorage);

  if (options.requireS3 && !useS3) {
    throw new Error("S3 env is not configured");
  }

  const rows = await db.select().from(guideEntities);
  const tasks = buildTasks(rows, options);
  const summary = {
    totalRows: rows.length,
    totalTasks: tasks.length,
    mirrored: [],
    skipped: [],
    failed: [],
    s3PublicMode: shouldUseS3PublicUrls(process.env),
    storageMode: useS3 ? "s3+local-cache" : "local-cache",
  };

  console.log(
    `[backfill-guide-entity-assets] start: rows=${rows.length}, tasks=${tasks.length}, storageMode=${summary.storageMode}, s3PublicMode=${summary.s3PublicMode}`,
  );

  for (const [index, task] of tasks.entries()) {
    try {
      const cachedFilePath = guideAssetStore.getCachedFilePath(task.assetKey);
      if (cachedFilePath && !options.force) {
        summary.skipped.push({
          ...task,
          reason: "already-cached",
          cachedFilePath,
        });
        logProgress({
          index: index + 1,
          total: tasks.length,
          task,
          outcome: "skip:already-cached",
          mirrored: summary.mirrored.length,
          skipped: summary.skipped.length,
          failed: summary.failed.length,
        });
        continue;
      }

      if (options.dryRun) {
        summary.skipped.push({
          ...task,
          reason: "dry-run",
        });
        logProgress({
          index: index + 1,
          total: tasks.length,
          task,
          outcome: "skip:dry-run",
          mirrored: summary.mirrored.length,
          skipped: summary.skipped.length,
          failed: summary.failed.length,
        });
        continue;
      }

      const publicUrl = await guideAssetStore.mirror(task.assetKey, task.sourceUrl);
      summary.mirrored.push({
        ...task,
        publicUrl,
      });
      logProgress({
        index: index + 1,
        total: tasks.length,
        task,
        outcome: "mirrored",
        mirrored: summary.mirrored.length,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      });
    } catch (error) {
      summary.failed.push({
        ...task,
        error: error instanceof Error ? error.message : String(error),
      });
      logProgress({
        index: index + 1,
        total: tasks.length,
        task,
        outcome: "failed",
        mirrored: summary.mirrored.length,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(async () => {
    try {
      await client.end();
    } catch (error) {
      console.warn(
        "[backfill-guide-entity-assets] failed to close Postgres client:",
        error instanceof Error ? error.message : String(error),
      );
    }
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[backfill-guide-entity-assets] error:", error);
    try {
      await client.end();
    } catch (closeError) {
      console.warn(
        "[backfill-guide-entity-assets] failed to close Postgres client:",
        closeError instanceof Error ? closeError.message : String(closeError),
      );
    }
    process.exit(1);
  });
