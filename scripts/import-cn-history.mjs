import "dotenv/config";
import { pathToFileURL } from "node:url";
import { request as httpsRequest } from "node:https";
import { and, eq, ne } from "drizzle-orm";

import { db, client } from "../db/client.js";
import { championStatsSnapshots, champions, championStatsHistory } from "../db/schema.js";
import {
  createChampionStatsSnapshot,
  determineChampionStatsSnapshotStatus,
  SNAPSHOT_STATUS_FAILED,
  updateChampionStatsSnapshot,
} from "../lib/statsSnapshots.mjs";

const HERO_RANK_URL =
  "https://mlol.qt.qq.com/go/lgame_battle_info/hero_rank_list_v2";
const CN_FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.CN_FETCH_TIMEOUT_MS || 20_000),
);
const CN_FETCH_RETRIES = Math.max(
  1,
  Number(process.env.CN_FETCH_RETRIES || 3),
);
const CN_FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  accept: "application/json,text/plain,*/*",
  referer: "https://lolm.qq.com/",
};

const RANK_MAP = {
  0: "overall",
  1: "diamondPlus",
  2: "masterPlus",
  3: "king",
  4: "peak",
};

const LANE_MAP = {
  1: "mid",
  2: "top",
  3: "adc",
  4: "support",
  5: "jungle",
};

function log(...args) {
  console.log(...args);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFloat(value) {
  if (value === undefined || value === null || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

async function fetchCnHeroRankOnce() {
  const text = await fetchTextViaHttps(HERO_RANK_URL, {
    timeoutMs: CN_FETCH_TIMEOUT_MS,
    headers: CN_FETCH_HEADERS,
    forceIpv4: true,
  });

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`hero_rank_list_v2 invalid json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function fetchTextViaHttps(
  url,
  { timeoutMs, headers, forceIpv4 = false, redirectCount = 0 },
) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = httpsRequest(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "GET",
        headers,
        family: forceIpv4 ? 4 : undefined,
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const location = res.headers.location;

        if (
          location &&
          [301, 302, 303, 307, 308].includes(statusCode) &&
          redirectCount < 5
        ) {
          res.resume();
          resolve(
            fetchTextViaHttps(new URL(location, parsedUrl).toString(), {
              timeoutMs,
              headers,
              forceIpv4,
              redirectCount: redirectCount + 1,
            }),
          );
          return;
        }

        const chunks = [];
        res.setEncoding("utf8");
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = chunks.join("");

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `hero_rank_list_v2 error ${statusCode}: ${body.slice(0, 200)}`,
              ),
            );
            return;
          }

          resolve(body);
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });

    req.on("error", reject);
    req.end();
  });
}

export async function fetchCnHeroRank() {
  log(
    `[cn-history] fetch hero_rank_list_v2: ${HERO_RANK_URL} timeout=${CN_FETCH_TIMEOUT_MS} retries=${CN_FETCH_RETRIES}`,
  );

  let lastError = null;

  for (let attempt = 1; attempt <= CN_FETCH_RETRIES; attempt += 1) {
    try {
      const json = await fetchCnHeroRankOnce();
      const data = json.data || {};
      const statsByHero = {};

      for (const rankKey of Object.keys(data)) {
        const rankName = RANK_MAP[rankKey] || `rank_${rankKey}`;
        const lanes = data[rankKey] || {};

        for (const laneKey of Object.keys(lanes)) {
          const laneName = LANE_MAP[laneKey] || `lane_${laneKey}`;
          const rows = Array.isArray(lanes[laneKey]) ? lanes[laneKey] : [];

          for (const item of rows) {
            const heroId = String(item.hero_id || "").trim();
            if (!heroId) continue;

            if (!statsByHero[heroId]) statsByHero[heroId] = {};
            if (!statsByHero[heroId][rankName]) statsByHero[heroId][rankName] = {};

            statsByHero[heroId][rankName][laneName] = {
              position: item.position ? Number(item.position) : null,
              winRate: toFloat(item.win_rate_percent ?? item.win_rate),
              pickRate: toFloat(item.appear_rate_percent ?? item.appear_rate),
              banRate: toFloat(item.forbid_rate_percent ?? item.forbid_rate),
              strengthLevel: item.strength_level ? Number(item.strength_level) : null,
            };
          }
        }
      }

      log(`[cn-history] hero_rank_list_v2 -> heroIds=${Object.keys(statsByHero).length}`);
      return statsByHero;
    } catch (error) {
      lastError = error;

      if (attempt < CN_FETCH_RETRIES) {
        console.warn(
          `[cn-history] retry ${attempt}/${CN_FETCH_RETRIES - 1} after ${error?.message || String(error)}`,
        );
        await sleep(1_000 * attempt);
      }
    }
  }

  throw lastError;
}

export async function loadCnHistoryChampionsFromDb() {
  const rows = await db
    .select({
      slug: champions.slug,
      cnHeroId: champions.cnHeroId,
    })
    .from(champions);

  const filteredRows = rows.filter((row) => !!row?.cnHeroId);
  log(`[cn-history] champions from DB -> total=${rows.length} withCnHeroId=${filteredRows.length}`);
  return filteredRows;
}

export function summarizeCnHistoryCoverage(championRows, statsByHeroId) {
  const dbCnHeroIds = new Set(championRows.map((champion) => String(champion.cnHeroId)));
  const apiHeroIds = new Set(Object.keys(statsByHeroId));

  const missingInApi = championRows.filter(
    (champion) => !apiHeroIds.has(String(champion.cnHeroId)),
  );
  const extraInApi = Array.from(apiHeroIds).filter((heroId) => !dbCnHeroIds.has(heroId));
  const matchedCount = championRows.length - missingInApi.length;

  log(
    `[cn-history] coverage -> champions=${championRows.length} heroIds=${apiHeroIds.size} matched=${matchedCount} missingInApi=${missingInApi.length} extraInApi=${extraInApi.length}`,
  );

  if (missingInApi.length > 0) {
    log(
      `[cn-history] missingInApi -> ${missingInApi
        .map((champion) => `${champion.slug}(${champion.cnHeroId})`)
        .join(", ")}`,
    );
  }

  if (extraInApi.length > 0) {
    log(`[cn-history] extraInApi -> ${extraInApi.join(", ")}`);
  }

  return {
    missingInApi,
    extraInApi,
    matchedCount,
  };
}

async function ensureCnHistoryInsertCompatibility() {
  await client`
    alter table champion_stats_history
    drop constraint if exists champion_stats_history_uq;
  `;

  await client`
    drop index if exists champion_stats_history_date_slug_rank_lane_uidx;
  `;

  await client`
    create unique index if not exists champion_stats_history_snapshot_slug_rank_lane_uidx
    on champion_stats_history (snapshot_id, slug, rank, lane);
  `;
}

function chunkRows(rows, size = 200) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

export async function runCnHistoryImport() {
  const today = new Date().toISOString().slice(0, 10);
  const runStartedAt = new Date();
  log(`[cn-history] start -> date=${today}`);

  await ensureCnHistoryInsertCompatibility();

  const snapshot = await createChampionStatsSnapshot({
    statsDate: today,
    startedAt: runStartedAt,
    metadata: {
      kind: "cn-history",
    },
  });

  try {
    const championRows = await loadCnHistoryChampionsFromDb();
    const statsByHeroId = await fetchCnHeroRank();
    const coverage = summarizeCnHistoryCoverage(championRows, statsByHeroId);

    let upserted = 0;
    let skippedNoStats = 0;
    const skippedNoStatsChampions = [];
    const preparedRows = [];
    let championsProcessed = 0;
    const totalChampions = championRows.length;

    for (const champion of championRows) {
      const cnHeroId = String(champion.cnHeroId);
      const heroStats = statsByHeroId[cnHeroId];

      if (!heroStats) {
        skippedNoStats += 1;
        skippedNoStatsChampions.push(`${champion.slug}(${cnHeroId})`);
        championsProcessed += 1;
        if (championsProcessed % 10 === 0 || championsProcessed === totalChampions) {
          log(
            `[cn-history] progress -> champions=${championsProcessed}/${totalChampions} upserted=${upserted} skippedNoStats=${skippedNoStats}`,
          );
        }
        continue;
      }

      for (const rankName of Object.keys(heroStats)) {
        const lanes = heroStats[rankName] || {};

        for (const laneName of Object.keys(lanes)) {
          const cell = lanes[laneName];
          const row = {
            snapshotId: snapshot.id,
            date: today,
            slug: champion.slug,
            cnHeroId,
            rank: rankName,
            lane: laneName,
            position: cell.position,
            winRate: cell.winRate,
            pickRate: cell.pickRate,
            banRate: cell.banRate,
            strengthLevel: cell.strengthLevel,
            createdAt: runStartedAt,
          };

          preparedRows.push(row);

          upserted += 1;

          if (upserted % 100 === 0) {
            log(
              `[cn-history] progress -> champions=${championsProcessed + 1}/${totalChampions} upserted=${upserted} current=${champion.slug}`,
            );
          }
        }
      }

      championsProcessed += 1;
      if (championsProcessed % 10 === 0 || championsProcessed === totalChampions) {
        log(
          `[cn-history] progress -> champions=${championsProcessed}/${totalChampions} upserted=${upserted} skippedNoStats=${skippedNoStats}`,
        );
      }
    }

    const report = {
      snapshotId: snapshot.id,
      date: today,
      champions: championRows.length,
      matched: coverage.matchedCount,
      missingInApi: coverage.missingInApi.length,
      extraInApi: coverage.extraInApi.length,
      upserted,
      skippedNoStats,
      skippedNoStatsChampions,
    };

    const snapshotStatus = determineChampionStatsSnapshotStatus({
      rowCount: upserted,
      championCount: championRows.length,
      matchedChampionCount: coverage.matchedCount,
    });

    const snapshotMetadata = {
      kind: "cn-history",
      missingInApi: coverage.missingInApi.map((champion) => ({
        slug: champion.slug,
        cnHeroId: champion.cnHeroId,
      })),
      extraInApi: coverage.extraInApi,
      skippedNoStatsChampions,
    };

    await db.transaction(async (tx) => {
      await tx
        .delete(championStatsHistory)
        .where(eq(championStatsHistory.date, today));

      await tx
        .delete(championStatsSnapshots)
        .where(
          and(
            eq(championStatsSnapshots.source, "cnHistory"),
            eq(championStatsSnapshots.statsDate, today),
            ne(championStatsSnapshots.id, snapshot.id),
          ),
        );

      for (const rowsChunk of chunkRows(preparedRows)) {
        await tx.insert(championStatsHistory).values(rowsChunk);
      }

      await tx
        .update(championStatsSnapshots)
        .set({
          status: snapshotStatus,
          completedAt: new Date(),
          championCount: championRows.length,
          matchedChampionCount: coverage.matchedCount,
          rowCount: upserted,
          missingChampionCount: coverage.missingInApi.length,
          metadata: snapshotMetadata,
        })
        .where(eq(championStatsSnapshots.id, snapshot.id));
    });

    console.log(
      `[cn-history] done -> snapshot=${snapshot.id} status=${snapshotStatus} champions=${report.champions} matched=${report.matched} upserted=${report.upserted} skippedNoStats=${report.skippedNoStats}`,
    );

    return report;
  } catch (error) {
    await updateChampionStatsSnapshot(snapshot.id, {
      status: SNAPSHOT_STATUS_FAILED,
      completedAt: new Date(),
    });
    throw error;
  }
}

async function main() {
  const report = await runCnHistoryImport();

  if ((report.skippedNoStats || 0) > 0) {
    console.warn(
      `[cn-history] skipped -> ${report.skippedNoStatsChampions.join(", ")}`,
    );
  }
}

const isDirectRun =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error("[cn-history] fatal error:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await client.end({ timeout: 5 });
      } catch {}
    });
}
