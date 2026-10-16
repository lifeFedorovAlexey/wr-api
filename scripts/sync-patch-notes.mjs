import "dotenv/config";
import { createHash } from "node:crypto";

import * as dbSchema from "../db/schema.js";
import { client, db } from "../db/client.js";
import { buildPatchChangeRows, loadPatchChangeCatalog } from "../lib/patchNotesChangeRecords.mjs";
import { enrichPatchSkinImages } from "../lib/patchSkinImages.mjs";
import {
  parsePatchArticle,
  parsePatchIndex,
  PATCH_NOTES_PARSER_VERSION,
} from "../lib/patchNotesParser.mjs";

const INDEX_URLS = {
  "en-us": "https://wildrift.leagueoflegends.com/en-us/news/tags/patch-notes/",
  "ru-ru": "https://wildrift.leagueoflegends.com/ru-ru/news/tags/patch-notes/",
};
const REQUEST_TIMEOUT_MS = Number(process.env.PATCH_NOTES_REQUEST_TIMEOUT_MS || 30000);
const MAX_RETRIES = Number(process.env.PATCH_NOTES_FETCH_RETRIES || 3);
const MAX_HISTORY = Number(process.env.PATCH_NOTES_MAX_HISTORY || 32);
const FORCE_SOURCE_REFRESH = process.argv.includes("--refresh-source");
const REPARSE_ARCHIVED = process.argv.includes("--reparse-archived");
const REQUESTED_PATCH_VERSIONS = process.argv
  .filter((argument) => argument.startsWith("--patch-version="))
  .map((argument) => argument.slice("--patch-version=".length).trim());

for (const version of REQUESTED_PATCH_VERSIONS) {
  if (!/^\d+\.\d+[a-z]?$/i.test(version)) throw new Error(`Invalid --patch-version value: ${version}`);
}

function comparePatchVersions(left, right) {
  const a = String(left).match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
  const b = String(right).match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
  return Number(b[1] || 0) - Number(a[1] || 0)
    || Number(b[2] || 0) - Number(a[2] || 0)
    || String(b[3] || "").localeCompare(String(a[3] || ""));
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
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
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
  await client`
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
  return hash;
}

async function markParsed(item, locale, hash, parsed, catalog) {
  let englishChanges = [];
  if (locale === "ru-ru") {
    const englishRows = await client`
      select parsed_payload from patch_notes
      where patch_version = ${item.version} and locale = 'en-us' and parse_status = 'parsed'
      limit 1
    `;
    englishChanges = englishRows[0]?.parsed_payload?.changes || [];
  }
  parsed.changes = await enrichPatchSkinImages(parsed.changes, englishChanges);
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
          change_type, section_name, change_name, details, updated_at
        ) values (
          ${item.version}, ${locale}, ${change.ordinal}, ${change.entityKind}, ${change.entitySlug},
          ${change.entityName}, ${change.imageUrl}, ${change.changeType}, ${change.sectionName},
          ${change.changeName}, ${transaction.json(JSON.stringify(change.details))}, now()
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

async function importPatch(item, locale, { force = false, catalog } = {}) {
  const stored = await getStored(locale, item.version);
  if (stored && !force && stored.parser_version === PATCH_NOTES_PARSER_VERSION && stored.parse_status === "parsed") {
    return "skipped";
  }

  let html = stored?.raw_html;
  let hash = stored?.content_hash;
  if (!html || force) {
    html = await fetchText(item.url);
    hash = await archiveRaw(item, locale, html);
  } else {
    await archiveRaw(item, locale, html);
  }

  try {
    const parsed = parsePatchArticle(html, item.version, locale, catalog);
    await markParsed(item, locale, hash, parsed, catalog);
    console.log(`[patch-notes] ${locale} ${item.version}: parsed changes=${parsed.changes.length}`);
    return "parsed";
  } catch (error) {
    await markFailed(locale, item.version, error);
    console.error(`[patch-notes] ${locale} ${item.version}: ${error.stack || error}`);
    return "failed";
  }
}

async function loadIndex(locale) {
  const html = await fetchText(INDEX_URLS[locale]);
  return parsePatchIndex(html, locale).slice(0, MAX_HISTORY);
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

function requestedPatchItem(version, locale) {
  return {
    version,
    locale,
    title: locale === "ru-ru" ? `Описание обновления ${version} для Wild Rift` : `Wild Rift Patch Notes ${version}`,
    description: "",
    url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-${version.replace(".", "-")}/`,
    publishedAt: null,
    imageUrl: null,
  };
}

function mergePatchItems(indexItems, archivedItems) {
  const byVersion = new Map();
  for (const item of archivedItems) byVersion.set(item.version, item);
  for (const item of indexItems) byVersion.set(item.version, { ...byVersion.get(item.version), ...item });
  return Array.from(byVersion.values()).sort((a, b) => comparePatchVersions(a.version, b.version));
}

async function main() {
  const catalog = await loadPatchChangeCatalog(dbSchema, db);
  console.log(`[patch-notes] entity catalogs loaded champions=${catalog.champions.size} items=${catalog.items.size}`);
  console.log("[patch-notes] English import phase started");
  const englishIndex = REQUESTED_PATCH_VERSIONS.length ? [] : await loadIndex("en-us");
  const englishItems = REQUESTED_PATCH_VERSIONS.length
    ? REQUESTED_PATCH_VERSIONS.map((version) => requestedPatchItem(version, "en-us"))
    : mergePatchItems(englishIndex, await loadArchivedItems("en-us", { all: REPARSE_ARCHIVED }));
  const latestEnglishVersion = englishItems[0]?.version;
  for (const item of englishItems) {
    try {
      await importPatch(item, "en-us", {
        force: REQUESTED_PATCH_VERSIONS.includes(item.version) || FORCE_SOURCE_REFRESH || item.version === latestEnglishVersion,
        catalog,
      });
    } catch (error) {
      console.error(`[patch-notes] en-us ${item.version}: ${error.stack || error}`);
      await markFailed("en-us", item.version, error).catch(() => undefined);
    }
  }

  const readyEnglish = await client`
    select patch_version from patch_notes
    where locale = 'en-us' and parse_status = 'parsed' and parsed_payload is not null
  `;
  const englishVersions = new Set(readyEnglish.map((row) => row.patch_version));

  console.log("[patch-notes] Russian import phase started after English phase");
  const russianIndex = REQUESTED_PATCH_VERSIONS.length ? [] : await loadIndex("ru-ru");
  const russianItems = REQUESTED_PATCH_VERSIONS.length
    ? REQUESTED_PATCH_VERSIONS.map((version) => requestedPatchItem(version, "ru-ru"))
    : mergePatchItems(russianIndex, await loadArchivedItems("ru-ru", { all: REPARSE_ARCHIVED }));
  const russianByVersion = new Map(russianItems.map((item) => [item.version, item]));
  for (const version of englishVersions) {
    const item = russianByVersion.get(version);
    if (!item) continue;
    try {
      await importPatch(item, "ru-ru", {
        force: REQUESTED_PATCH_VERSIONS.includes(version) || FORCE_SOURCE_REFRESH || version === russianItems[0]?.version,
        catalog,
      });
    } catch (error) {
      console.error(`[patch-notes] ru-ru ${version}: ${error.stack || error}`);
      await markFailed("ru-ru", version, error).catch(() => undefined);
    }
  }
  console.log(`[patch-notes] finished: ${englishVersions.size} English versions available${REQUESTED_PATCH_VERSIONS.length ? `; explicitly requested ${REQUESTED_PATCH_VERSIONS.join(", ")}` : ""}`);
}

main()
  .catch((error) => {
    console.error("[patch-notes] sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
