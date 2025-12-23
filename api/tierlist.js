// api/tierlist.js
import { db } from "../db/client.js";
import { championStatsHistory, champions } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

import { and, desc, eq, sql } from "drizzle-orm";

function setPublicCache(res, { sMaxAge = 300, swr = 1800 } = {}) {
  // Общий CDN-кеш (Vercel). Ключ кеша = полный URL (path + query).
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`
  );
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

// Date -> 'YYYY-MM-DD'
function toDateString(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// strengthLevel -> tier
function strengthToTier(level) {
  if (level == null) return "C";

  switch (level) {
    case 0:
      return "S+";
    case 1:
      return "S";
    case 2:
      return "A";
    case 3:
      return "B";
    case 4:
      return "C";
    case 5:
    default:
      return "D";
  }
}

export default async function handler(req, res) {
  // CORS
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { rank, lane, lang } = req.query;

  const rankKey =
    typeof rank === "string" && rank.trim() ? rank.trim() : "diamondPlus";
  const laneKey = typeof lane === "string" && lane.trim() ? lane.trim() : "top";
  const language =
    typeof lang === "string" && lang.trim() ? lang.trim() : "ru_ru";

  try {
    // 1) Узнаём последнюю дату ТОЛЬКО для нужных rank+lane
    const latestRow = await db
      .select({
        date: championStatsHistory.date,
      })
      .from(championStatsHistory)
      .where(
        and(
          eq(championStatsHistory.rank, rankKey),
          eq(championStatsHistory.lane, laneKey)
        )
      )
      .orderBy(desc(championStatsHistory.date))
      .limit(1);

    const latestDate = latestRow.length
      ? toDateString(latestRow[0].date)
      : null;

    if (!latestDate) {
      setPublicCache(res, { sMaxAge: 60, swr: 300 });
      return res.status(200).json({
        filters: {
          rank: rankKey,
          lane: laneKey,
          date: null,
          lang: language,
        },
        tiersOrder: ["S+", "S", "A", "B", "C", "D"],
        tiers: {
          "S+": [],
          S: [],
          A: [],
          B: [],
          C: [],
          D: [],
        },
      });
    }

    // 2) Берём ТОЛЬКО нужные строки истории (rank+lane+date)
    const historyRows = await db
      .select()
      .from(championStatsHistory)
      .where(
        and(
          eq(championStatsHistory.rank, rankKey),
          eq(championStatsHistory.lane, laneKey),
          eq(championStatsHistory.date, sql`${latestDate}::date`)
        )
      );

    // 3) Чемпионы (маленькая таблица, можно целиком)
    const championsRows = await db.select().from(champions);

    const champBySlug = {};
    for (const ch of championsRows) {
      if (ch?.slug) champBySlug[ch.slug] = ch;
    }

    // 4) Собираем тиры
    const tiersOrder = ["S+", "S", "A", "B", "C", "D"];
    const tiers = {
      "S+": [],
      S: [],
      A: [],
      B: [],
      C: [],
      D: [],
    };

    for (const row of historyRows) {
      const slug = row.slug;
      if (!slug) continue;

      const tier = strengthToTier(row.strengthLevel);
      const ch = champBySlug[slug];

      let displayName = slug;
      if (ch) {
        const nameLoc = ch.nameLocalizations || {};
        displayName = nameLoc[language] || nameLoc.en_us || ch.name || slug;
      }

      tiers[tier].push({
        slug,
        cnHeroId: row.cnHeroId,
        name: displayName,
        icon: ch?.icon || null,
        rank: row.rank,
        lane: row.lane,
        date: latestDate,
        position: row.position,
        winRate: row.winRate,
        pickRate: row.pickRate,
        banRate: row.banRate,
        strengthLevel: row.strengthLevel,
      });
    }

    // 5) Сортировка внутри тиров (как у тебя)
    for (const key of tiersOrder) {
      tiers[key].sort((a, b) => {
        const aw = a.winRate ?? 0;
        const bw = b.winRate ?? 0;
        if (bw !== aw) return bw - aw;

        const ap = a.pickRate ?? 0;
        const bp = b.pickRate ?? 0;
        return bp - ap;
      });
    }

    setPublicCache(res, { sMaxAge: 300, swr: 1800 });
    return res.status(200).json({
      filters: {
        rank: rankKey,
        lane: laneKey,
        date: latestDate,
        lang: language,
      },
      tiersOrder,
      tiers,
    });
  } catch (e) {
    console.error("[wr-api] /api/tierlist error:", e);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
