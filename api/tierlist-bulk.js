import { db } from "../db/client.js";
import { championStatsHistory, champions } from "../db/schema.js";
import { setCors } from "./utils/cors.js";
import { desc, eq, sql } from "drizzle-orm";

function setPublicCache(res, { sMaxAge = 300, swr = 1800 } = {}) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`
  );
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

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
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { lang } = req.query;
  const language =
    typeof lang === "string" && lang.trim() ? lang.trim() : "ru_ru";

  try {
    // 1) Одна общая последняя дата по всей истории
    const latestRow = await db
      .select({ date: championStatsHistory.date })
      .from(championStatsHistory)
      .orderBy(desc(championStatsHistory.date))
      .limit(1);

    const latestDate = latestRow.length
      ? toDateString(latestRow[0].date)
      : null;

    if (!latestDate) {
      setPublicCache(res, { sMaxAge: 60, swr: 300 });
      return res.status(200).json({
        filters: { date: null, lang: language },
        tiersOrder: ["S+", "S", "A", "B", "C", "D"],
        tiersByRankLane: {},
      });
    }

    // 2) Все строки только за latestDate
    const historyRows = await db
      .select()
      .from(championStatsHistory)
      .where(eq(championStatsHistory.date, sql`${latestDate}::date`));

    // 3) Чемпионы
    const championsRows = await db.select().from(champions);

    const champBySlug = {};
    for (const ch of championsRows) {
      if (ch?.slug) champBySlug[ch.slug] = ch;
    }

    // 4) Группируем: rank|lane -> tiers
    const tiersOrder = ["S+", "S", "A", "B", "C", "D"];
    const tiersByRankLane = {};

    function ensureBucket(rank, lane) {
      const key = `${rank}|${lane}`;
      if (!tiersByRankLane[key]) {
        tiersByRankLane[key] = {
          rank,
          lane,
          tiers: { "S+": [], S: [], A: [], B: [], C: [], D: [] },
        };
      }
      return tiersByRankLane[key];
    }

    for (const row of historyRows) {
      const slug = row.slug;
      const rank = row.rank;
      const lane = row.lane;
      if (!slug || !rank || !lane) continue;

      const bucket = ensureBucket(rank, lane);

      const tier = strengthToTier(row.strengthLevel);
      const ch = champBySlug[slug];

      let displayName = slug;
      if (ch) {
        const nameLoc = ch.nameLocalizations || {};
        displayName = nameLoc[language] || nameLoc.en_us || ch.name || slug;
      }

      bucket.tiers[tier].push({
        slug,
        cnHeroId: row.cnHeroId,
        name: displayName,
        icon: ch?.icon || null,
        rank,
        lane,
        date: latestDate,
        position: row.position,
        winRate: row.winRate,
        pickRate: row.pickRate,
        banRate: row.banRate,
        strengthLevel: row.strengthLevel,
      });
    }

    // 5) сортировка внутри каждого bucket
    for (const key of Object.keys(tiersByRankLane)) {
      const bucket = tiersByRankLane[key];
      for (const tierKey of tiersOrder) {
        bucket.tiers[tierKey].sort((a, b) => {
          const aw = a.winRate ?? 0;
          const bw = b.winRate ?? 0;
          if (bw !== aw) return bw - aw;

          const ap = a.pickRate ?? 0;
          const bp = b.pickRate ?? 0;
          return bp - ap;
        });
      }
    }

    setPublicCache(res, { sMaxAge: 300, swr: 1800 });
    return res.status(200).json({
      filters: { date: latestDate, lang: language },
      tiersOrder,
      tiersByRankLane,
    });
  } catch (e) {
    console.error("[wr-api] /api/tierlist-bulk error:", e);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
