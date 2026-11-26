import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import * as dbSchema from "../db/schema.js";
import { client, db } from "../db/client.js";
import { buildPatchChangeRows, loadPatchChangeCatalog } from "../lib/patchNotesChangeRecords.mjs";
import { enrichPatchSkinImages } from "../lib/patchSkinImages.mjs";
import { buildPatchDryRunReport } from "../lib/patchNoteDryRun.mjs";
import { selectPatchHistory } from "../lib/patchNoteHistorySelection.mjs";
import {
  isMissingRussianFallbackArticle,
  resolveRequestedPatchItem,
  selectRequestedPatchItems,
} from "../lib/patchNoteRequestedItems.mjs";
import {
  assertPatchArticleReadyForImport,
  parsePatchArticle,
  parsePatchIndex,
  PATCH_NOTES_PARSER_VERSION,
} from "../lib/patchNotesParser.mjs";
import { resolvePatchImportSource } from "../lib/patchNoteImportSource.mjs";
import { loadValidatedRiotPatchArchiveItems } from "../lib/patchNoteArchiveCache.mjs";
import { comparePatchVersions, isValidPatchVersion } from "../lib/patchVersion.mjs";

const INDEX_URLS = {
  "en-us": "https://wildrift.leagueoflegends.com/en-us/news/tags/patch-notes/",
  "ru-ru": "https://wildrift.leagueoflegends.com/ru-ru/news/tags/patch-notes/",
};
const REQUEST_TIMEOUT_MS = Number(process.env.PATCH_NOTES_REQUEST_TIMEOUT_MS || 30000);
const MAX_RETRIES = Number(process.env.PATCH_NOTES_FETCH_RETRIES || 3);
const HISTORY_LIMIT = process.env.PATCH_NOTES_MAX_HISTORY;
const FORCE_SOURCE_REFRESH = process.argv.includes("--refresh-source");
const REPARSE_ARCHIVED = process.argv.includes("--reparse-archived");
const OFFLINE = process.argv.includes("--offline");
const DRY_RUN = process.argv.includes("--dry-run");
const USE_AUDITED_ARCHIVE_CACHE = process.argv.includes("--use-audited-archive-cache");
const ARCHIVE_AUDIT_ROOT = new URL("../.patch-audit/live-index/", import.meta.url);
const ARCHIVE_AUDIT_REPORT = new URL("../.patch-audit/live-index/audit-report.json", import.meta.url);
const REQUESTED_PATCH_VERSIONS = process.argv
  .filter((argument) => argument.startsWith("--patch-version="))
  .map((argument) => argument.slice("--patch-version=".length).trim());

for (const version of REQUESTED_PATCH_VERSIONS) {
  if (!isValidPatchVersion(version)) throw new Error(`Invalid --patch-version value: ${version}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function carryForwardExistingImages(changes, existingRows) {
  const images = new Map();
  for (const row of existingRows) {
    if (!row.imageUrl || !/^https:\/\/s3\.twcstorage\.ru\//i.test(row.imageUrl)) continue;
    const kind = row.entityKind || "system";
    if (row.entitySlug) images.set(`${kind}:slug:${row.entitySlug}`, row.imageUrl);
    if (row.entityName) images.set(`${kind}:name:${row.entityName.trim().toLocaleLowerCase()}`, row.imageUrl);
  }
  for (const change of changes) {
    if (change.imageUrl) continue;
    const kind = change.entityKind || "system";
    change.imageUrl = (change.entitySlug && images.get(`${kind}:slug:${change.entitySlug}`))
      || (change.entityName && images.get(`${kind}:name:${change.entityName.trim().toLocaleLowerCase()}`))
      || null;
  }
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "WildRiftAllStatsPatchNotesBot/1.0 (+https://wildriftallstats.ru)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} for ${url}`);
        error.status = response.status;
        throw error;
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function getStored(locale, version) {
  const rows = await client`
    select raw_html, content_hash, parser_version, parse_status, parsed_payload
    from patch_notes where locale = ${locale} and patch_version = ${version} limit 1
  `;
  return rows[0] || null;
}

async function archiveRaw(item, locale, html, status = "pending", error = null) {
  const hash = sha256(html);
  await client.begin(async (transaction) => {
    await transaction`
      insert into patch_note_source_revisions (
        patch_version, locale, content_hash, source_url, raw_html
      ) values (
        ${item.version}, ${locale}, ${hash}, ${item.url}, ${html}
      )
      on conflict (patch_version, locale, content_hash) do nothing
    `;
    await transaction`
      insert into patch_notes (
        patch_version, locale, title, description, source_url, published_at, image_url,
        raw_html, content_hash, parser_version, parse_status, parse_error
      ) values (
        ${item.version}, ${locale}, ${item.title}, ${item.description || null}, ${item.url},
        ${item.publishedAt || null}, ${item.imageUrl || null}, ${html}, ${hash},
        ${PATCH_NOTES_PARSER_VERSION}, ${status}, ${error}
      )
      on conflict (patch_version, locale) do update set
        title = excluded.title,
        description = excluded.description,
        source_url = excluded.source_url,
        published_at = excluded.published_at,
        image_url = excluded.image_url,
        raw_html = excluded.raw_html,
        content_hash = excluded.content_hash,
        parser_version = excluded.parser_version,
        parse_status = excluded.parse_status,
        parse_error = excluded.parse_error,
        updated_at = now()
    `;
  });
  return hash;
}

async function markParsed(item, locale, hash, parsed, catalog, { offline = false } = {}) {
  let englishChanges = [];
  if (locale === "ru-ru") {
    const englishRows = await client`
      select parsed_payload from patch_notes
      where patch_version = ${item.version} and locale = 'en-us' and parse_status = 'parsed'
      limit 1
    `;
    englishChanges = englishRows[0]?.parsed_payload?.changes || [];
  }
  parsed.changes = await enrichPatchSkinImages(parsed.changes, englishChanges, { fetchGalleries: !offline });
  const changes = buildPatchChangeRows(parsed.changes, catalog, englishChanges, item.version);

  await client.begin(async (transaction) => {
    const existingRows = await transaction`
      select entity_kind as "entityKind", entity_slug as "entitySlug", entity_name as "entityName", image_url as "imageUrl"
      from patch_note_changes
      where patch_version = ${item.version} and locale = ${locale}
    `;
    carryForwardExistingImages(changes, existingRows);
    parsed.changes = changes;
    await transaction`
      update patch_notes set
        title = ${parsed.title}, description = ${parsed.description || item.description || null},
        source_url = ${parsed.sourceUrl || item.url}, published_at = ${parsed.publishedAt || item.publishedAt || null},
        effective_date = ${parsed.effectiveDate || null}, effective_region = ${parsed.effectiveRegion || null},
        effective_date_source_url = ${parsed.effectiveDateSourceUrl || null},
        image_url = ${parsed.imageUrl || item.imageUrl || null}, content_hash = ${hash},
        parser_version = ${PATCH_NOTES_PARSER_VERSION}, parse_status = 'parsed', parse_error = null,
        parsed_payload = ${transaction.json(JSON.stringify(parsed))}, updated_at = now()
      where patch_version = ${item.version} and locale = ${locale}
    `;
    await transaction`delete from patch_note_changes where patch_version = ${item.version} and locale = ${locale}`;
    for (const change of changes) {
      await transaction`
        insert into patch_note_changes (
          patch_version, locale, ordinal, entity_kind, entity_slug, entity_name, image_url,
          change_type, section_name, change_name, scope, details, updated_at
        ) values (
          ${item.version}, ${locale}, ${change.ordinal}, ${change.entityKind}, ${change.entitySlug},
          ${change.entityName}, ${change.imageUrl}, ${change.changeType}, ${change.sectionName},
          ${change.changeName}, ${change.scope ? transaction.json(JSON.stringify(change.scope)) : null},
          ${transaction.json(JSON.stringify(change.details))}, now()
        )
      `;
    }
  });
}

async function markFailed(locale, version, error) {
  const message = String(error?.message || error).slice(0, 1000);
  await client`
    update patch_notes set parse_status = 'failed', parse_error = ${message}, updated_at = now()
    where patch_version = ${version} and locale = ${locale}
  `;
}

async function importPatch(item, locale, {
  reparse = false,
  refreshSource = false,
  catalog,
  englishChanges = [],
} = {}) {
  if (item.offlineSourceStatus === "unverified-not-cached") {
    return { status: "unverified", reason: "source-not-cached" };
  }

  const stored = await getStored(locale, item.version);
  const source = resolvePatchImportSource({
    stored,
    parserVersion: PATCH_NOTES_PARSER_VERSION,
    auditedArchive: item.auditedArchive,
    reparse,
    refreshSource,
    offline: OFFLINE,
  });
  if (source.action === "skip") {
    return { status: "skipped" };
  }
  if (source.action === "missing-archive") {
    throw new Error(`No archived source exists for ${locale} patch ${item.version}; --offline prevents fetching it`);
  }

  let html = source.html;
  let hash = source.contentHash;
  if (source.action === "parse-audited-archive") {
    html = await readFile(source.cacheFile, "utf8");
    hash = sha256(html);
    if (!DRY_RUN) {
      await archiveRaw({ ...item, url: source.sourceUrl }, locale, html);
    }
  }
  if (source.action === "fetch") {
    try {
      html = await fetchText(item.url);
    } catch (error) {
      if (isMissingRussianFallbackArticle(item, locale, error)) {
        return { status: "unavailable", reason: "no-russian-article" };
      }
      throw error;
    }
    hash = DRY_RUN ? sha256(html) : await archiveRaw(item, locale, html);
  }

  try {
    const parsed = assertPatchArticleReadyForImport(parsePatchArticle(html, item.version, locale, catalog, {
      sourceAlias: source.sourceAlias || null,
    }));
    if (DRY_RUN) {
      parsed.changes = await enrichPatchSkinImages(parsed.changes, englishChanges, { fetchGalleries: false });
      const rows = buildPatchChangeRows(parsed.changes, catalog, englishChanges, item.version);
      parsed.changes = rows;
      const report = buildPatchDryRunReport({
        patchVersion: item.version,
        locale,
        sourceAction: source.action,
        contentHash: hash,
        rows,
      });
      console.log(`[patch-notes:dry-run] ${JSON.stringify(report)}`);
      return { status: "parsed", report, changes: rows };
    }
    await markParsed(item, locale, hash, parsed, catalog, { offline: OFFLINE });
    const sourceLabel = source.action === "parse-archive" || source.action === "parse-audited-archive"
      ? `archived HTML ${hash.slice(0, 12)}`
      : "fetched HTML";
    console.log(`[patch-notes] ${locale} ${item.version}: ${sourceLabel}; parsed changes=${parsed.changes.length}`);
    return { status: "parsed" };
  } catch (error) {
    if (!DRY_RUN) await markFailed(locale, item.version, error);
    console.error(`[patch-notes] ${locale} ${item.version}: ${error.stack || error}`);
    return { status: "failed", error };
  }
}

async function loadIndex(locale, { limit = HISTORY_LIMIT } = {}) {
  const html = await fetchText(INDEX_URLS[locale]);
  return selectPatchHistory(parsePatchIndex(html, locale), limit);
}

function shouldReparseVersion(version) {
  return REPARSE_ARCHIVED || REQUESTED_PATCH_VERSIONS.includes(version);
}

function shouldRefreshVersion(version, latestVersion) {
  return FORCE_SOURCE_REFRESH
    || (!OFFLINE && !REQUESTED_PATCH_VERSIONS.length && version === latestVersion);
}

async function loadPatchItems(locale) {
  const auditedArchiveItems = USE_AUDITED_ARCHIVE_CACHE
    ? await loadValidatedRiotPatchArchiveItems({
      reportPath: ARCHIVE_AUDIT_REPORT,
      cacheRoot: ARCHIVE_AUDIT_ROOT,
      locale,
      requestedVersions: REQUESTED_PATCH_VERSIONS,
    })
    : [];

  if (REQUESTED_PATCH_VERSIONS.length) {
    const indexItems = OFFLINE ? [] : await loadIndex(locale, { limit: null });
    const archivedItems = await loadArchivedItems(locale, { all: true });
    const requestedItems = selectRequestedPatchItems(REQUESTED_PATCH_VERSIONS, indexItems, archivedItems, locale);
    const auditedByVersion = new Map(auditedArchiveItems.map((item) => [item.version, item]));
    return requestedItems.map((item) => resolveRequestedPatchItem(item, {
      auditedArchiveItem: auditedByVersion.get(item.version),
      locale,
      offline: OFFLINE,
      useAuditedArchiveCache: USE_AUDITED_ARCHIVE_CACHE,
    }));
  }

  const indexItems = OFFLINE ? [] : await loadIndex(locale);
  const archivedItems = await loadArchivedItems(locale, { all: REPARSE_ARCHIVED || OFFLINE });
  return mergePatchItems(indexItems, archivedItems, auditedArchiveItems);
}

async function loadArchivedItems(locale, { all = false } = {}) {
  const rows = await client`
    select patch_version as version, locale, title, description, source_url as url,
      published_at as "publishedAt", image_url as "imageUrl"
    from patch_notes
    where locale = ${locale} and raw_html is not null
      and (${all} or parse_status <> 'parsed' or parser_version < ${PATCH_NOTES_PARSER_VERSION})
    order by published_at desc nulls last, patch_version desc
  `;
  return rows;
}

function mergePatchItems(indexItems, archivedItems, auditedArchiveItems = []) {
  const byVersion = new Map();
  for (const item of auditedArchiveItems) byVersion.set(item.version, item);
  for (const item of archivedItems) {
    const previous = byVersion.get(item.version);
    byVersion.set(item.version, {
      ...previous,
      ...item,
      ...(previous?.auditedArchive ? { auditedArchive: previous.auditedArchive } : {}),
    });
  }
  for (const item of indexItems) {
    const previous = byVersion.get(item.version);
    byVersion.set(item.version, {
      ...previous,
      ...item,
      ...(previous?.auditedArchive ? { auditedArchive: previous.auditedArchive } : {}),
    });
  }
  return Array.from(byVersion.values()).sort((a, b) => comparePatchVersions(b.version, a.version));
}

async function importPatchSafely(item, locale, { catalog, englishChanges = [], latestVersion } = {}) {
  try {
    return await importPatch(item, locale, {
      reparse: DRY_RUN || shouldReparseVersion(item.version),
      refreshSource: shouldRefreshVersion(item.version, latestVersion),
      catalog,
      englishChanges,
    });
  } catch (error) {
    console.error(`[patch-notes] ${locale} ${item.version}: ${error.stack || error}`);
    if (!DRY_RUN) await markFailed(locale, item.version, error).catch(() => undefined);
    return { status: "failed", error };
  }
}

async function importPatchItems(items, locale, {
  catalog,
  englishChangesByVersion = new Map(),
  latestVersion = items[0]?.version,
} = {}) {
  const results = [];
  for (const item of items) {
    results.push(await importPatchSafely(item, locale, {
      catalog,
      englishChanges: englishChangesByVersion.get(item.version) || [],
      latestVersion,
    }));
  }
  return results;
}

async function main() {
  const catalog = await loadPatchChangeCatalog(dbSchema, db);
  console.log(`[patch-notes] entity catalogs loaded champions=${catalog.champions.size} items=${catalog.items.size}`);
  console.log("[patch-notes] English import phase started");
  const englishItems = await loadPatchItems("en-us");
  const englishResults = await importPatchItems(englishItems, "en-us", {
    catalog,
    latestVersion: englishItems[0]?.version,
  });
  const dryRunEnglishChanges = new Map(englishResults.flatMap((result, index) => (
    DRY_RUN && result.status === "parsed" ? [[englishItems[index].version, result.changes]] : []
  )));
  const failedImports = englishResults.flatMap((result, index) => (
    result.status === "failed" ? [`en-us ${englishItems[index].version}`] : []
  ));

  let englishVersions;
  if (DRY_RUN) {
    englishVersions = new Set(dryRunEnglishChanges.keys());
  } else {
    const readyEnglish = await client`
      select patch_version from patch_notes
      where locale = 'en-us' and parse_status = 'parsed' and parsed_payload is not null
    `;
    englishVersions = new Set(readyEnglish.map((row) => row.patch_version));
  }

  console.log("[patch-notes] Russian import phase started after English phase");
  const russianItems = await loadPatchItems("ru-ru");
  const russianByVersion = new Map(russianItems.map((item) => [item.version, item]));
  const russianCandidates = [...englishVersions]
    .map((version) => russianByVersion.get(version))
    .filter(Boolean);
  const russianResults = await importPatchItems(russianCandidates, "ru-ru", {
    catalog,
    englishChangesByVersion: dryRunEnglishChanges,
    latestVersion: russianItems[0]?.version,
  });
  failedImports.push(...russianResults.flatMap((result, index) => (
    result.status === "failed" ? [`ru-ru ${russianCandidates[index].version}`] : []
  )));
  const unavailableImports = [
    ...englishResults.flatMap((result, index) => (
      result.status === "unavailable" ? [`en-us ${englishItems[index].version}`] : []
    )),
    ...russianResults.flatMap((result, index) => (
      result.status === "unavailable" ? [`ru-ru ${russianCandidates[index].version}`] : []
    )),
  ];
  const unverifiedImports = [
    ...englishResults.flatMap((result, index) => (
      result.status === "unverified" ? [`en-us ${englishItems[index].version}`] : []
    )),
    ...russianResults.flatMap((result, index) => (
      result.status === "unverified" ? [`ru-ru ${russianCandidates[index].version}`] : []
    )),
  ];
  console.log(`[patch-notes${DRY_RUN ? ":dry-run" : ""}] finished: ${englishVersions.size} English versions available${REQUESTED_PATCH_VERSIONS.length ? `; explicitly requested ${REQUESTED_PATCH_VERSIONS.join(", ")}` : ""}${DRY_RUN ? "; no database writes performed" : ""}`);
  if (unavailableImports.length) {
    console.log(`[patch-notes] localized article not published: ${unavailableImports.join(", ")}`);
  }
  if (unverifiedImports.length) {
    console.log(`[patch-notes] source not cached; publication status unverified in offline mode: ${unverifiedImports.join(", ")}`);
  }
  if (failedImports.length) {
    console.error(`[patch-notes] ${failedImports.length} imports failed: ${failedImports.join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[patch-notes] sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
