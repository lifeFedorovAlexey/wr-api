import "dotenv/config";

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

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
import { filterChampionsForPublicPool } from "../lib/championPublicPool.mjs";
import { getSourceChampionSlugCandidates } from "../lib/championSlug.mjs";
import { createObjectStorageClient } from "../lib/objectStorage.mjs";
import { normalizeRiftGgCnStats, parseRiftGgCnStatsHtml } from "../lib/riftggCnStats.mjs";

const REQUEST_TIMEOUT_MS = Math.max(1_000, Number(process.env.RIFTGG_REQUEST_TIMEOUT_MS || 20_000));
const IMPORT_CONCURRENCY = Math.max(1, Number(process.env.RIFTGG_IMPORT_CONCURRENCY || 6));
const MAX_FETCH_ATTEMPTS = Math.max(1, Number(process.env.RIFTGG_FETCH_RETRIES || 2));
const SLOW_IMPORT_LOG_MS = Math.max(1_000, Number(process.env.RIFTGG_SLOW_IMPORT_LOG_MS || 15_000));
let dictionariesSyncPromise = Promise.resolve();
const reservedDictionaryKeys = new Set();
const queuedRiftItemEntries = new Map();
let guideAssetStorePromise = null;
let guideAssetLogSummary = null;
const itemSourceProbeCache = new Map();
let itemSourceResolutionSummary = null;

const ITEM_IMAGE_SOURCE_RESOLVERS = [
  {
    key: "wildriftfire",
    build(slug) {
      return `https://www.wildriftfire.com/images/items/${encodeURIComponent(String(slug || "").trim())}.png`;
    },
  },
  {
    key: "riftgg-assets",
    build(slug) {
      return `https://assets.riftgg.app/items/${encodeURIComponent(String(slug || "").trim())}.webp`;
    },
  },
];

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
    guideAssetStorePromise = createGuideAssetStore(process.env, {
      onFallbackDir({ fallbackDir, assetsDir, error }) {
        console.warn(
          `[riftgg-cn-stats] item assets -> fallbackDir=${fallbackDir} originalDir=${assetsDir} reason=${error?.message || error}`,
        );
      },
      onMirrorError({ assetKey, error }) {
        if (!guideAssetLogSummary) {
          guideAssetLogSummary = {
            totalErrors: 0,
            byReason: new Map(),
          };
        }

        const message = String(error?.message || error || "unknown-error").trim();
        const reason = /^HTTP 404$/i.test(message) ? "http-404" : message;
        const bucket = guideAssetLogSummary.byReason.get(reason) || { count: 0, samples: [] };

        guideAssetLogSummary.totalErrors += 1;
        bucket.count += 1;
        if (bucket.samples.length < 5 && !bucket.samples.includes(assetKey)) {
          bucket.samples.push(assetKey);
        }

        guideAssetLogSummary.byReason.set(reason, bucket);
      },
    });
  }

  return guideAssetStorePromise;
}

function toRiftGgSlug(slug) {
  return getSourceChampionSlugCandidates(slug, "riftgg")[0] || String(slug || "").trim();
}

async function probeItemSourceUrl(url) {
  const normalized = String(url || "").trim();
  if (!normalized) {
    return false;
  }

  if (itemSourceProbeCache.has(normalized)) {
    return itemSourceProbeCache.get(normalized);
  }

  const probePromise = (async () => {
    try {
      const response = await fetch(normalized, {
        method: "HEAD",
        headers: {
          "user-agent": "wildriftallstats-bot/1.0 (+https://wildriftallstats.ru)",
          accept: "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
        },
      });

      if (response.ok) {
        return true;
      }

      if (response.status === 405) {
        const fallbackResponse = await fetch(normalized, {
          method: "GET",
          headers: {
            "user-agent": "wildriftallstats-bot/1.0 (+https://wildriftallstats.ru)",
            accept: "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
            range: "bytes=0-0",
          },
        });
        return fallbackResponse.ok;
      }

      return false;
    } catch {
      return false;
    }
  })();

  itemSourceProbeCache.set(normalized, probePromise);
  return probePromise;
}

function detectItemSourceKeyFromUrl(url = "") {
  const normalized = String(url || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("wildriftfire.com/images/items/")) return "wildriftfire";
  if (normalized.includes("assets.riftgg.app/items/")) return "riftgg-assets";
  return "existing";
}

function trackItemSourceResolution({ slug, sourceKey, usedFallback = false, unresolved = false }) {
  if (!itemSourceResolutionSummary) {
    itemSourceResolutionSummary = {
      total: 0,
      unresolved: 0,
      fallbackUsed: 0,
      bySource: new Map(),
      fallbackSamples: [],
      unresolvedSamples: [],
    };
  }

  itemSourceResolutionSummary.total += 1;

  if (unresolved) {
    itemSourceResolutionSummary.unresolved += 1;
    if (
      itemSourceResolutionSummary.unresolvedSamples.length < 5 &&
      !itemSourceResolutionSummary.unresolvedSamples.includes(slug)
    ) {
      itemSourceResolutionSummary.unresolvedSamples.push(slug);
    }
    return;
  }

  const sourceCount = itemSourceResolutionSummary.bySource.get(sourceKey) || 0;
  itemSourceResolutionSummary.bySource.set(sourceKey, sourceCount + 1);

  if (usedFallback) {
    itemSourceResolutionSummary.fallbackUsed += 1;
    const sample = `${slug}:${sourceKey}`;
    if (
      itemSourceResolutionSummary.fallbackSamples.length < 5 &&
      !itemSourceResolutionSummary.fallbackSamples.includes(sample)
    ) {
      itemSourceResolutionSummary.fallbackSamples.push(sample);
    }
  }
}

async function resolveItemImageSourceUrl(slug, existingSourceUrl = "") {
  const normalizedSlug = String(slug || "").trim();
  const existing = String(existingSourceUrl || "").trim();
  const candidates = [];
  const seen = new Set();

  function pushCandidate(sourceKey, sourceUrl) {
    const normalized = String(sourceUrl || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push({ sourceKey, sourceUrl: normalized });
  }

  if (existing) {
    pushCandidate(detectItemSourceKeyFromUrl(existing), existing);
  }

  for (const resolver of ITEM_IMAGE_SOURCE_RESOLVERS) {
    pushCandidate(resolver.key, resolver.build(normalizedSlug));
  }

  for (const candidate of candidates) {
    if (await probeItemSourceUrl(candidate.sourceUrl)) {
      trackItemSourceResolution({
        slug: normalizedSlug,
        sourceKey: candidate.sourceKey,
        usedFallback: candidate.sourceKey !== "wildriftfire",
      });
      return candidate;
    }
  }

  trackItemSourceResolution({
    slug: normalizedSlug,
    sourceKey: "unresolved",
    unresolved: true,
  });
  return null;
}

async function fetchRiftGgChampionHtml(slug) {
  const riftGgSlug = toRiftGgSlug(slug);
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`https://www.riftgg.app/en/champions/${riftGgSlug}/cn-stats`, {
        headers: {
          "user-agent": "wildriftallstats-bot/1.0 (+https://wildriftallstats.ru)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
      });
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

      const html = await response.text();
      clearTimeout(timeout);
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
    await db
      .insert(riftggCnDictionaries)
      .values(
        pendingEntries.map((entry) => ({
          kind: entry.kind,
          slug: entry.slug,
          name: entry.name,
          rawPayload: entry.rawPayload,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [riftggCnDictionaries.kind, riftggCnDictionaries.slug],
        set: {
          name: sql`excluded.name`,
          rawPayload: sql`excluded.raw_payload`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
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
    const existing = existingBySlug.get(slug);
    const resolvedSource =
      (await resolveItemImageSourceUrl(slug, existing?.imageUrl || existing?.tooltipImageUrl || "")) || null;
    const sourceUrl = resolvedSource?.sourceUrl || null;
    const imageSourceUrl = sourceUrl;
    const tooltipSourceUrl = sourceUrl;
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
    const needsImage = Boolean(sourceUrl) && (!existing?.imageUrl || !hasImageAsset || existing.imageUrl !== imageSourceUrl);
    const needsTooltip = Boolean(sourceUrl) && (!existing?.tooltipImageUrl || !hasTooltipAsset || existing.tooltipImageUrl !== tooltipSourceUrl);

    if (!needsImage && !needsTooltip) {
      summary.skipped += 1;
      continue;
    }

    if (!sourceUrl) {
      summary.failed += 1;
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

  if (itemSourceResolutionSummary?.total) {
    const sources = Array.from(itemSourceResolutionSummary.bySource.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([sourceKey, count]) => `${sourceKey}:${count}`)
      .join(" | ");
    const fallbackSamples = itemSourceResolutionSummary.fallbackSamples.length
      ? ` fallbackSamples=${itemSourceResolutionSummary.fallbackSamples.join(",")}`
      : "";
    const unresolvedSamples = itemSourceResolutionSummary.unresolvedSamples.length
      ? ` unresolvedSamples=${itemSourceResolutionSummary.unresolvedSamples.join(",")}`
      : "";

    console.warn(
      `[riftgg-cn-stats] item asset sources -> total=${itemSourceResolutionSummary.total} fallback=${itemSourceResolutionSummary.fallbackUsed} unresolved=${itemSourceResolutionSummary.unresolved} ${sources}${fallbackSamples}${unresolvedSamples}`,
    );
  }

  if (guideAssetLogSummary?.totalErrors) {
    const details = Array.from(guideAssetLogSummary.byReason.entries())
      .sort((left, right) => right[1].count - left[1].count)
      .map(([reason, data]) => {
        const sampleSuffix = data.samples.length ? ` samples=${data.samples.join(",")}` : "";
        return `${reason}:${data.count}${sampleSuffix}`;
      })
      .join(" | ");

    console.warn(
      `[riftgg-cn-stats] item asset mirror issues -> total=${guideAssetLogSummary.totalErrors} ${details}`,
    );
  }

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
  const startedAt = Date.now();
  const html = await fetchRiftGgChampionHtml(slug);

  if (!html) {
    console.log(`[riftgg-cn-stats] ${index}/${total} ${slug} -> skip:page-not-found`);
    return { type: "skipped", slug, reason: "page-not-found" };
  }

  const parsed = parseRiftGgCnStatsHtml(html);
  const normalized = normalizeRiftGgCnStats(slug, parsed);
  const now = new Date();
  await ensureDictionariesSynced(normalized.dictionaries, now);
  queueRiftItemAssets(normalized.dictionaries);

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
    `[riftgg-cn-stats] ${index}/${total} ${slug} -> ok | matchups=${normalized.matchups.length} builds=${normalized.builds.length} dictionaries=${normalized.dictionaries.length} elapsed=${Date.now() - startedAt}ms`,
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
  guideAssetLogSummary = null;
  itemSourceResolutionSummary = null;
  itemSourceProbeCache.clear();
  const requestedSlugs = getRequestedSlugs();
  const championRows = requestedSlugs.length
    ? await db
        .select({ slug: champions.slug, nameLocalizations: champions.nameLocalizations })
        .from(champions)
        .where(inArray(champions.slug, requestedSlugs))
    : await db
        .select({ slug: champions.slug, nameLocalizations: champions.nameLocalizations })
        .from(champions);

  const publicChampionRows = filterChampionsForPublicPool(championRows);

  const slugs = publicChampionRows.map((row) => row.slug).filter(Boolean);
  const uploaded = [];
  const skipped = [];
  const failed = [];
  const filteredOutCount = championRows.length - publicChampionRows.length;

  console.log(
    `[riftgg-cn-stats] start: champions=${slugs.length}${requestedSlugs.length ? " (filtered)" : ""} concurrency=${IMPORT_CONCURRENCY}${filteredOutCount > 0 ? ` excludedNonPublic=${filteredOutCount}` : ""}`,
  );

  let cursor = 0;
  async function worker() {
    while (cursor < slugs.length) {
      const currentIndex = cursor;
      cursor += 1;

      const slug = slugs[currentIndex];
      const slowImportTimer = setTimeout(() => {
        console.warn(
          `[riftgg-cn-stats] ${currentIndex + 1}/${slugs.length} ${slug} -> still-running after ${SLOW_IMPORT_LOG_MS}ms`,
        );
      }, SLOW_IMPORT_LOG_MS);

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
      } finally {
        clearTimeout(slowImportTimer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, slugs.length) }, () => worker()));
  const itemAssetSummary = await reconcileQueuedRiftItemAssets();

  console.log(
    `[riftgg-cn-stats] done -> total=${slugs.length} uploaded=${uploaded.length} skipped=${skipped.length} failed=${failed.length} itemAssetsMirrored=${itemAssetSummary.mirrored} itemAssetsFailed=${itemAssetSummary.failed}`,
  );

  if (skipped.length) {
    console.warn(
      `[riftgg-cn-stats] skipped -> ${skipped.map((entry) => `${entry.slug}:${entry.reason}`).join(" | ")}`,
    );
  }

  if (failed.length) {
    console.error(
      `[riftgg-cn-stats] failed -> ${failed.map((entry) => `${entry.slug}:${entry.error}`).join(" | ")}`,
    );
  }

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
