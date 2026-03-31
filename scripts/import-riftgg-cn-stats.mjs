import "dotenv/config";

import { eq, inArray } from "drizzle-orm";

import { db, client } from "../db/client.js";
import {
  champions,
  riftggCnBuilds,
  riftggCnDictionaries,
  riftggCnMatchups,
} from "../db/schema.js";
import { normalizeRiftGgCnStats, parseRiftGgCnStatsHtml } from "../lib/riftggCnStats.mjs";

const REQUEST_TIMEOUT_MS = 30_000;
const RIFTGG_SLUG_ALIASES = {
  nunu: "nunu-and-willump",
};

function getRequestedSlugs() {
  return process.argv.slice(2).map((value) => String(value || "").trim()).filter(Boolean);
}

function toRiftGgSlug(slug) {
  return RIFTGG_SLUG_ALIASES[slug] || slug;
}

async function fetchRiftGgChampionHtml(slug) {
  const riftGgSlug = toRiftGgSlug(slug);
  const response = await fetch(`https://www.riftgg.app/en/champions/${riftGgSlug}/cn-stats`, {
    headers: {
      "user-agent": "wildriftallstats-bot/1.0 (+https://wildriftallstats.ru)",
      accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
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
    `[riftgg-cn-stats] start: champions=${slugs.length}${requestedSlugs.length ? " (filtered)" : ""}`,
  );

  for (let index = 0; index < slugs.length; index += 1) {
    const slug = slugs[index];

    try {
      const html = await fetchRiftGgChampionHtml(slug);

      if (!html) {
        skipped.push({ slug, reason: "page-not-found" });
        console.log(
          `[riftgg-cn-stats] ${index + 1}/${slugs.length} ${slug} -> skip:page-not-found`,
        );
        continue;
      }

      const parsed = parseRiftGgCnStatsHtml(html);
      const normalized = normalizeRiftGgCnStats(slug, parsed);
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx.delete(riftggCnMatchups).where(eq(riftggCnMatchups.championSlug, slug));
        await tx.delete(riftggCnBuilds).where(eq(riftggCnBuilds.championSlug, slug));

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

        for (const entry of normalized.dictionaries) {
          await tx
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

      uploaded.push({
        slug,
        matchups: normalized.matchups.length,
        builds: normalized.builds.length,
        dictionaries: normalized.dictionaries.length,
      });

      console.log(
        `[riftgg-cn-stats] ${index + 1}/${slugs.length} ${slug} -> ok | matchups=${normalized.matchups.length} builds=${normalized.builds.length} dictionaries=${normalized.dictionaries.length}`,
      );
    } catch (error) {
      failed.push({ slug, error: error?.message || String(error) });
      console.error(`[riftgg-cn-stats] ${index + 1}/${slugs.length} ${slug} -> failed`, error);
    }
  }

  console.log(
    JSON.stringify(
      {
        total: slugs.length,
        uploaded,
        skipped,
        failed,
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
