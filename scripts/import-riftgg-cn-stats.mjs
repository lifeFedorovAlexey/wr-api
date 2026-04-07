import "dotenv/config";

import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { db, client } from "../db/client.js";
import {
  champions,
  guideEntities,
  riftggCnBuilds,
  riftggCnDictionaries,
  riftggCnMatchups,
} from "../db/schema.js";
import {
  buildGuideAssetKey,
  buildGuideAssetStorageKey,
  createGuideAssetStore,
} from "../lib/guideAssets.mjs";
import { createObjectStorageClient } from "../lib/objectStorage.mjs";
import { normalizeRiftGgCnStats, parseRiftGgCnStatsHtml } from "../lib/riftggCnStats.mjs";

const REQUEST_TIMEOUT_MS = Math.max(1_000, Number(process.env.RIFTGG_REQUEST_TIMEOUT_MS || 20_000));
const IMPORT_CONCURRENCY = Math.max(1, Number(process.env.RIFTGG_IMPORT_CONCURRENCY || 6));
const MAX_FETCH_ATTEMPTS = Math.max(1, Number(process.env.RIFTGG_FETCH_RETRIES || 2));
const RIFTGG_SLUG_ALIASES = {
  aurelionsol: "aurelion-sol",
  drmundo: "dr-mundo",
  jarvaniv: "jarvan-iv",
  leesin: "lee-sin",
  missfortune: "miss-fortune",
  masteryi: "master-yi",
  monkeyking: "wukong",
  nunu: "nunu-and-willump",
  twistedfate: "twisted-fate",
  xinzhao: "xin-zhao",
};
let dictionariesSyncPromise = Promise.resolve();
const reservedDictionaryKeys = new Set();
const queuedRiftItemEntries = new Map();
let guideAssetStorePromise = null;

function warnSlugLookup({ service, requestedSlug, candidateSlug = "", source = "", status = "" }) {
  const parts = [
    "[slug-warn]",
    `service=${service}`,
    `requested=${String(requestedSlug || "").trim() || "-"}`,
  ];

  if (candidateSlug) {
    parts.push(`candidate=${String(candidateSlug).trim()}`);
  }
  if (source) {
    parts.push(`source=${source}`);
  }
  if (status) {
    parts.push(`status=${status}`);
  }

  console.warn(parts.join(" "));
}

function getRequestedSlugs() {
  return process.argv.slice(2).map((value) => String(value || "").trim()).filter(Boolean);
}

function getGuideAssetStore() {
  if (!guideAssetStorePromise) {
    guideAssetStorePromise = createGuideAssetStore(process.env);
  }

  return guideAssetStorePromise;
}

function toRiftGgSlug(slug) {
  return RIFTGG_SLUG_ALIASES[slug] || slug;
}

function buildWildRiftFireItemImageUrl(slug) {
  return `https://www.wildriftfire.com/images/items/${encodeURIComponent(String(slug || "").trim())}.png`;
}

async function fetchRiftGgChampionHtml(slug) {
  const riftGgSlug = toRiftGgSlug(slug);
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);

    try {
      console.log(`[riftgg-cn-stats] ${slug} -> fetch attempt ${attempt}/${MAX_FETCH_ATTEMPTS}`);
      const response = await fetch(`https://www.riftgg.app/en/champions/${riftGgSlug}/cn-stats`, {
        headers: {
          "user-agent": "wildriftallstats-bot/1.0 (+https://wildriftallstats.ru)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
      });
      console.log(`[riftgg-cn-stats] ${slug} -> response ${response.status}`);

      if (response.status === 404) {
        warnSlugLookup({
          service: "wr-api/import-riftgg-cn-stats",
          requestedSlug: slug,
          candidateSlug: riftGgSlug,
          source: "riftgg",
          status: "404",
        });
        clearTimeout(timeout);
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log(`[riftgg-cn-stats] ${slug} -> reading body`);
      const html = await response.text();
      clearTimeout(timeout);
      console.log(`[riftgg-cn-stats] ${slug} -> body bytes=${html.length}`);
      return html;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt < MAX_FETCH_ATTEMPTS) {
        console.warn(
          `[riftgg-cn-stats] ${slug} -> retry ${attempt}/${MAX_FETCH_ATTEMPTS - 1} after ${error?.message || String(error)}`,
        );
      }
    }
  }

  throw lastError;
}

async function ensureDictionariesSynced(entries, now = new Date()) {
  if (!Array.isArray(entries) || !entries.length) {
    return;
  }

  const pendingEntries = [];
  const pendingKeys = [];

  for (const entry of entries) {
    const kind = String(entry?.kind || "").trim();
    const slug = String(entry?.slug || "").trim();
    if (!kind || !slug) {
      continue;
    }

    const key = `${kind}:${slug}`;
    if (reservedDictionaryKeys.has(key)) {
      continue;
    }

    reservedDictionaryKeys.add(key);
    pendingKeys.push(key);
    pendingEntries.push(entry);
  }

  if (!pendingEntries.length) {
    return;
  }

  const task = dictionariesSyncPromise.catch(() => {}).then(async () => {
    for (const entry of pendingEntries) {
      await db
        .insert(riftggCnDictionaries)
        .values({
          kind: entry.kind,
          slug: entry.slug,
          name: entry.name,
          rawPayload: entry.rawPayload,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [riftggCnDictionaries.kind, riftggCnDictionaries.slug],
          set: {
            name: entry.name,
            rawPayload: entry.rawPayload,
            updatedAt: now,
          },
        });
    }
  });

  dictionariesSyncPromise = task;

  try {
    await task;
  } catch (error) {
    for (const key of pendingKeys) {
      reservedDictionaryKeys.delete(key);
    }
    throw error;
  }
}

function queueRiftItemAssets(entries) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.kind !== "item" || !entry?.slug) {
      continue;
    }

    const slug = String(entry.slug).trim();
    if (!slug || queuedRiftItemEntries.has(slug)) {
      continue;
    }

    queuedRiftItemEntries.set(slug, {
      slug,
      name: String(entry.name || slug).trim(),
    });
  }
}

async function hasMirroredGuideAsset({
  guideAssetStore,
  objectStorage,
  assetKey,
  sourceUrl,
}) {
  if (!assetKey || !sourceUrl) {
    return false;
  }

  if (objectStorage) {
    return await objectStorage.objectExists(
      buildGuideAssetStorageKey(assetKey, sourceUrl),
    );
  }

  return Boolean(guideAssetStore.getCachedFilePath(assetKey));
}

async function reconcileQueuedRiftItemAssets(now = new Date()) {
  const pendingEntries = Array.from(queuedRiftItemEntries.values());
  if (!pendingEntries.length) {
    return { total: 0, mirrored: 0, skipped: 0, failed: 0, updatedRows: 0 };
  }

  const itemSlugs = pendingEntries.map((entry) => entry.slug);
  const existingRows = await db
    .select({
      slug: guideEntities.slug,
      name: guideEntities.name,
      imageUrl: guideEntities.imageUrl,
      tooltipImageUrl: guideEntities.tooltipImageUrl,
    })
    .from(guideEntities)
    .where(and(eq(guideEntities.kind, "item"), inArray(guideEntities.slug, itemSlugs)));
  const existingBySlug = new Map(existingRows.map((row) => [row.slug, row]));
  const guideAssetStore = await getGuideAssetStore();
  const objectStorage = createObjectStorageClient(process.env);
  const summary = { total: pendingEntries.length, mirrored: 0, skipped: 0, failed: 0, updatedRows: 0 };

  for (const entry of pendingEntries) {
    const slug = entry.slug;
    const sourceUrl = buildWildRiftFireItemImageUrl(slug);
    const existing = existingBySlug.get(slug);
    const imageSourceUrl = existing?.imageUrl || sourceUrl;
    const tooltipSourceUrl = existing?.tooltipImageUrl || sourceUrl;
    const imageAssetKey = buildGuideAssetKey("guide", "item", slug, "image");
    const tooltipAssetKey = buildGuideAssetKey("guide", "item", slug, "tooltip");
    const hasImageAsset = existing?.imageUrl
      ? await hasMirroredGuideAsset({
          guideAssetStore,
          objectStorage,
          assetKey: imageAssetKey,
          sourceUrl: imageSourceUrl,
        })
      : false;
    const hasTooltipAsset = existing?.tooltipImageUrl
      ? await hasMirroredGuideAsset({
          guideAssetStore,
          objectStorage,
          assetKey: tooltipAssetKey,
          sourceUrl: tooltipSourceUrl,
        })
      : false;
    const needsImage = !existing?.imageUrl || !hasImageAsset;
    const needsTooltip = !existing?.tooltipImageUrl || !hasTooltipAsset;

    if (!needsImage && !needsTooltip) {
      summary.skipped += 1;
      continue;
    }

    try {
      if (!existing) {
        await db
          .insert(guideEntities)
          .values({
            kind: "item",
            slug,
            name: entry.name,
            imageUrl: sourceUrl,
            tooltipTitle: entry.name,
            tooltipImageUrl: sourceUrl,
            updatedAt: now,
          })
          .onConflictDoNothing();
      } else {
        await db
          .update(guideEntities)
          .set({
            imageUrl: existing.imageUrl || sourceUrl,
            tooltipImageUrl: existing.tooltipImageUrl || sourceUrl,
            tooltipTitle: existing.name || entry.name,
            updatedAt: now,
          })
          .where(and(eq(guideEntities.kind, "item"), eq(guideEntities.slug, slug)));
      }

      summary.updatedRows += 1;

      if (needsImage) {
        await guideAssetStore.mirror(imageAssetKey, imageSourceUrl);
        summary.mirrored += 1;
      }

      if (needsTooltip) {
        await guideAssetStore.mirror(tooltipAssetKey, tooltipSourceUrl);
        summary.mirrored += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.warn(`[riftgg-cn-stats] item asset reconcile failed for ${slug}:`, error?.message || error);
    }
  }

  console.log(
    `[riftgg-cn-stats] item asset reconcile -> total=${summary.total} updatedRows=${summary.updatedRows} mirrored=${summary.mirrored} skipped=${summary.skipped} failed=${summary.failed}`,
  );

  return summary;
}

function collectRowDataDates(rows = []) {
  const dates = [];
  let includesNull = false;

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.dataDate == null) {
      includesNull = true;
      continue;
    }

    const value = String(row.dataDate).trim();
    if (!value || dates.includes(value)) {
      continue;
    }

    dates.push(value);
  }

  return {
    dates,
    includesNull,
  };
}

function buildDataDateFilter(column, rows) {
  const { dates, includesNull } = collectRowDataDates(rows);
  const filters = [];

  if (dates.length) {
    filters.push(inArray(column, dates));
  }

  if (includesNull) {
    filters.push(isNull(column));
  }

  if (!filters.length) {
    return null;
  }

  return filters.length === 1 ? filters[0] : or(...filters);
}

async function importChampionStats({ slug, index, total }) {
  console.log(`[riftgg-cn-stats] ${index}/${total} ${slug} -> start`);
  const html = await fetchRiftGgChampionHtml(slug);

  if (!html) {
    console.log(`[riftgg-cn-stats] ${index}/${total} ${slug} -> skip:page-not-found`);
    return { type: "skipped", slug, reason: "page-not-found" };
  }

  console.log(`[riftgg-cn-stats] ${index}/${total} ${slug} -> parse`);
  const parsed = parseRiftGgCnStatsHtml(html);
  console.log(`[riftgg-cn-stats] ${index}/${total} ${slug} -> normalize`);
  const normalized = normalizeRiftGgCnStats(slug, parsed);
  const now = new Date();
  console.log(`[riftgg-cn-stats] ${index}/${total} ${slug} -> sync dictionaries=${normalized.dictionaries.length}`);
  await ensureDictionariesSynced(normalized.dictionaries, now);
  queueRiftItemAssets(normalized.dictionaries);

  console.log(`[riftgg-cn-stats] ${index}/${total} ${slug} -> write matchups=${normalized.matchups.length} builds=${normalized.builds.length}`);
  await db.transaction(async (tx) => {
    const matchupDateFilter = buildDataDateFilter(riftggCnMatchups.dataDate, normalized.matchups);
    const buildDateFilter = buildDataDateFilter(riftggCnBuilds.dataDate, normalized.builds);

    if (matchupDateFilter) {
      await tx
        .delete(riftggCnMatchups)
        .where(and(eq(riftggCnMatchups.championSlug, slug), matchupDateFilter));
    }

    if (buildDateFilter) {
      await tx
        .delete(riftggCnBuilds)
        .where(and(eq(riftggCnBuilds.championSlug, slug), buildDateFilter));
    }

    if (normalized.matchups.length) {
      await tx.insert(riftggCnMatchups).values(
        normalized.matchups.map((row) => ({
          championSlug: row.championSlug,
          rank: row.rank,
          lane: row.lane,
          dataDate: row.dataDate,
          opponentSlug: row.opponentSlug,
          winRate: row.winRate,
          pickRate: row.pickRate,
          winRateRank: row.winRateRank,
          pickRateRank: row.pickRateRank,
          rawPayload: row.rawPayload,
          updatedAt: now,
        })),
      );
    }

    if (normalized.builds.length) {
      await tx.insert(riftggCnBuilds).values(
        normalized.builds.map((row) => ({
          championSlug: row.championSlug,
          rank: row.rank,
          lane: row.lane,
          dataDate: row.dataDate,
          buildType: row.buildType,
          buildKey: row.buildKey,
          entrySlugs: row.entrySlugs,
          winRate: row.winRate,
          pickRate: row.pickRate,
          winRateRank: row.winRateRank,
          pickRateRank: row.pickRateRank,
          rawPayload: row.rawPayload,
          updatedAt: now,
        })),
      );
    }

  });

  console.log(
    `[riftgg-cn-stats] ${index}/${total} ${slug} -> ok | matchups=${normalized.matchups.length} builds=${normalized.builds.length} dictionaries=${normalized.dictionaries.length}`,
  );

  return {
    type: "uploaded",
    slug,
    matchups: normalized.matchups.length,
    builds: normalized.builds.length,
    dictionaries: normalized.dictionaries.length,
  };
}

async function main() {
  const requestedSlugs = getRequestedSlugs();
  const championRows = requestedSlugs.length
    ? await db
        .select({ slug: champions.slug })
        .from(champions)
        .where(inArray(champions.slug, requestedSlugs))
    : await db.select({ slug: champions.slug }).from(champions);

  const slugs = championRows.map((row) => row.slug).filter(Boolean);
  const uploaded = [];
  const skipped = [];
  const failed = [];

  console.log(
    `[riftgg-cn-stats] start: champions=${slugs.length}${requestedSlugs.length ? " (filtered)" : ""} concurrency=${IMPORT_CONCURRENCY}`,
  );

  let cursor = 0;
  async function worker() {
    while (cursor < slugs.length) {
      const currentIndex = cursor;
      cursor += 1;

      const slug = slugs[currentIndex];
      try {
        const result = await importChampionStats({
          slug,
          index: currentIndex + 1,
          total: slugs.length,
        });

        if (result.type === "uploaded") {
          uploaded.push(result);
        } else if (result.type === "skipped") {
          skipped.push({ slug: result.slug, reason: result.reason });
        }
      } catch (error) {
        failed.push({ slug, error: error?.message || String(error) });
        console.error(`[riftgg-cn-stats] ${currentIndex + 1}/${slugs.length} ${slug} -> failed`, error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, slugs.length) }, () => worker()));
  const itemAssetSummary = await reconcileQueuedRiftItemAssets();

  console.log(
    JSON.stringify(
      {
        total: slugs.length,
        uploaded,
        skipped,
        failed,
        itemAssets: itemAssetSummary,
      },
      null,
      2,
    ),
  );

  if (failed.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[riftgg-cn-stats] fatal error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
