// scripts/import-cn-history.mjs
// Тянем китайскую статистику hero_rank_list_v2
// и пишем историю в таблицу champion_stats_history.
// Никаких JSON-файлов, только Postgres.

import "dotenv/config";
import { db } from "../db/client.js";
import { client } from "../db/client.js";
import { champions, championStatsHistory } from "../db/schema.js";

// URL китайской статистики по винрейту
const HERO_RANK_URL =
  "https://mlol.qt.qq.com/go/lgame_battle_info/hero_rank_list_v2";

// Ранги (подтверждено по Кейл):
// 0 → сводка (все)
// 1 → Алмаз+
// 2 → Мастер+
// 3 → ГМ+
// 4 → Чалик
const RANK_MAP = {
  0: "overall",
  1: "diamondPlus",
  2: "masterPlus",
  3: "king",
  4: "peak",
};

// Линии: по факту API даёт так:
// 1 → mid
// 2 → top
// 3 → adc
// 4 → support
// 5 → jungle
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

function toFloat(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 1. Тянем hero_rank_list_v2 и собираем statsByHeroId как в merge-cn-full
async function fetchHeroRank() {
  log("📥 Fetch hero_rank_list_v2:", HERO_RANK_URL);
  const res = await fetch(HERO_RANK_URL);

  if (!res.ok) {
    const t = await res.text();
    throw new Error(
      `hero_rank_list_v2 error ${res.status}: ${t.slice(0, 200)}`
    );
  }

  const json = await res.json();
  const data = json.data || {};
  const statsByHero = {}; // heroId -> { rankName: { laneName: {..} } }

  for (const rankKey of Object.keys(data)) {
    const rankName = RANK_MAP[rankKey] || `rank_${rankKey}`;
    const lanesObj = data[rankKey];

    for (const laneKey of Object.keys(lanesObj)) {
      const laneName = LANE_MAP[laneKey] || `lane_${laneKey}`;
      const arr = lanesObj[laneKey];

      for (const item of arr) {
        const heroId = String(item.hero_id);
        if (!statsByHero[heroId]) statsByHero[heroId] = {};
        if (!statsByHero[heroId][rankName]) statsByHero[heroId][rankName] = {};

        const cell = {
          position: item.position ? Number(item.position) : null,
          winRate: toFloat(item.win_rate_percent ?? item.win_rate),
          pickRate: toFloat(item.appear_rate_percent ?? item.appear_rate),
          banRate: toFloat(item.forbid_rate_percent ?? item.forbid_rate),
          strengthLevel: item.strength_level
            ? Number(item.strength_level)
            : null,
        };

        statsByHero[heroId][rankName][laneName] = cell;
      }
    }
  }

  log(
    `✅ hero_rank_list_v2: собраны статы для ${
      Object.keys(statsByHero).length
    } hero_id`
  );
  return statsByHero;
}

async function loadChampionsFromDb() {
  const rows = await db
    .select({
      slug: champions.slug,
      cnHeroId: champions.cnHeroId,
    })
    .from(champions);

  log(`[db] champions: получено ${rows.length} записей из БД`);
  return rows.filter((c) => !!c.cnHeroId);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const runStartedAt = new Date();
  log("🚀 Старт import-cn-history.mjs, date =", today);

  // 1) чемпионы из БД (только те, у кого есть cnHeroId)
  const champs = await loadChampionsFromDb();

  // 2) китайская стата по рангу и лайнам
  const statsByHeroId = await fetchHeroRank();

  let inserted = 0;
  let updated = 0;
  let skippedNoStats = 0;

  for (const champ of champs) {
    const cnHeroId = String(champ.cnHeroId);
    const slug = champ.slug;

    const heroStats = statsByHeroId[cnHeroId];
    if (!heroStats) {
      skippedNoStats++;
      continue;
    }

    for (const rankName of Object.keys(heroStats)) {
      const lanes = heroStats[rankName];

      for (const laneName of Object.keys(lanes)) {
        const cell = lanes[laneName];

        const row = {
          date: today,
          slug,
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

        // UPSERT по (date, slug, rank, lane)
        const res = await db
          .insert(championStatsHistory)
          .values(row)
          .onConflictDoUpdate({
            target: [
              championStatsHistory.date,
              championStatsHistory.slug,
              championStatsHistory.rank,
              championStatsHistory.lane,
            ],
            set: row,
          });

        // Drizzle не даёт прямо понять insert vs update из res,
        // поэтому просто считаем как "updated++" для всех,
        // а ниже можем логнуть статистику по количеству строк.
        updated++;
      }
    }
  }

  log(
    `💾 import-cn-history: updated=${updated}, skipped(noStats)=${skippedNoStats}`
  );
  log("✅ import-cn-history.mjs завершён");
}

main()
  .then(async () => {
    // корректно закрываем коннект к БД
    try {
      await client.end();
    } catch (e) {
      console.warn(
        "⚠ Не удалось корректно закрыть клиент Postgres:",
        e?.message || e
      );
    }
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("❌ Ошибка в import-cn-history.mjs:", err);
    try {
      await client.end();
    } catch {
      // игнор
    }
    process.exit(1);
  });
