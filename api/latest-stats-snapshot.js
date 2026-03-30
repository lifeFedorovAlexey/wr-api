import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

import { desc, eq, inArray, sql } from "drizzle-orm";

const EXCLUDED_RANK_KEYS = new Set(["overall"]);
const LOW_ELO_RANKS = new Set(["diamondPlus", "masterPlus"]);
const HIGH_ELO_RANKS = new Set(["king", "peak"]);
let cachedSnapshot = null;

function setPublicCache(res, { sMaxAge = 300, swr = 1800 } = {}) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
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

function getSeriesDelta(values) {
  const finite = values.filter(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
  if (finite.length < 2) return null;
  return Number((finite[finite.length - 1] - finite[0]).toFixed(2));
}

function rankMatchesRange(rankKey, rankRange) {
  if (!rankKey || EXCLUDED_RANK_KEYS.has(rankKey)) return false;
  if (rankRange === "low") return LOW_ELO_RANKS.has(rankKey);
  if (rankRange === "high") return HIGH_ELO_RANKS.has(rankKey);
  return true;
}

function mapHistoryRows(rows) {
  return rows.map((row) => ({
    date: toDateString(row.date),
    slug: row.slug,
    rank: row.rank,
    lane: row.lane,
    position: row.position,
    winRate: row.winRate,
    pickRate: row.pickRate,
    banRate: row.banRate,
    strengthLevel: row.strengthLevel,
  }));
}

function buildMonthlyPicksBans({ historyItems, dates }) {
  const ranges = ["low", "high", "all"];
  const byRange = {};

  for (const rankRange of ranges) {
    const slugMap = new Map();

    for (const item of historyItems) {
      const date = item?.date ? String(item.date) : null;
      const slug = item?.slug;
      const rankKey = item?.rank;

      if (!date || !slug || !rankMatchesRange(rankKey, rankRange)) continue;

      if (!slugMap.has(slug)) {
        slugMap.set(slug, new Map());
      }

      const dateMap = slugMap.get(slug);
      if (!dateMap.has(date)) {
        dateMap.set(date, {
          pickSum: 0,
          pickCount: 0,
          banSum: 0,
          banCount: 0,
          banRanks: new Set(),
        });
      }

      const agg = dateMap.get(date);
      const pickRate =
        typeof item.pickRate === "number" && Number.isFinite(item.pickRate)
          ? item.pickRate
          : null;
      const banRate =
        typeof item.banRate === "number" && Number.isFinite(item.banRate)
          ? item.banRate
          : null;

      if (pickRate != null) {
        agg.pickSum += pickRate;
        agg.pickCount += 1;
      }

      if (banRate != null && !agg.banRanks.has(rankKey)) {
        agg.banSum += banRate;
        agg.banCount += 1;
        agg.banRanks.add(rankKey);
      }
    }

    byRange[rankRange] = {};

    for (const [slug, dateMap] of slugMap.entries()) {
      const pickRateTrend = dates.map((date) => {
        const agg = dateMap.get(date);
        if (!agg || agg.pickCount <= 0) return null;
        return Number((agg.pickSum / agg.pickCount).toFixed(2));
      });

      const banRateTrend = dates.map((date) => {
        const agg = dateMap.get(date);
        if (!agg || agg.banCount <= 0) return null;
        return Number((agg.banSum / agg.banCount).toFixed(2));
      });

      byRange[rankRange][slug] = {
        pickRateTrend,
        banRateTrend,
        pickRateDelta: getSeriesDelta(pickRateTrend),
        banRateDelta: getSeriesDelta(banRateTrend),
      };
    }
  }

  return {
    dates,
    byRange,
  };
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const [latestRow, recentDatesRows] = await Promise.all([
      db
        .select({ date: championStatsHistory.date })
        .from(championStatsHistory)
        .orderBy(desc(championStatsHistory.date))
        .limit(1),
      db
        .selectDistinct({ date: championStatsHistory.date })
        .from(championStatsHistory)
        .orderBy(desc(championStatsHistory.date))
        .limit(30),
    ]);

    const latestDate = latestRow.length
      ? toDateString(latestRow[0].date)
      : null;
    const recentDates = recentDatesRows
      .map((row) => toDateString(row.date))
      .filter(Boolean)
      .sort();

    if (cachedSnapshot && cachedSnapshot.latestDate === latestDate) {
      setPublicCache(res);
      return res.status(200).json(cachedSnapshot.payload);
    }

    if (!latestDate) {
      const emptyPayload = {
        filters: { date: null },
        count: 0,
        items: [],
        picksBansMonthly: {
          dates: [],
          byRange: { low: {}, high: {}, all: {} },
        },
      };
      cachedSnapshot = { latestDate: null, payload: emptyPayload };
      setPublicCache(res);
      return res.status(200).json(emptyPayload);
    }

    const rowShape = {
      date: championStatsHistory.date,
      slug: championStatsHistory.slug,
      rank: championStatsHistory.rank,
      lane: championStatsHistory.lane,
      position: championStatsHistory.position,
      winRate: championStatsHistory.winRate,
      pickRate: championStatsHistory.pickRate,
      banRate: championStatsHistory.banRate,
      strengthLevel: championStatsHistory.strengthLevel,
    };

    const [latestRows, recentRows] = await Promise.all([
      db
        .select(rowShape)
        .from(championStatsHistory)
        .where(eq(championStatsHistory.date, sql`${latestDate}::date`)),
      recentDates.length
        ? db
            .select(rowShape)
            .from(championStatsHistory)
            .where(
              inArray(
                sql`to_char(${championStatsHistory.date}, 'YYYY-MM-DD')`,
                recentDates,
              ),
            )
        : Promise.resolve([]),
    ]);

    const items = mapHistoryRows(latestRows);
    const recentItems = mapHistoryRows(recentRows);
    const picksBansMonthly = buildMonthlyPicksBans({
      historyItems: recentItems,
      dates: recentDates,
    });

    const payload = {
      filters: { date: latestDate },
      count: items.length,
      items,
      picksBansMonthly,
    };

    cachedSnapshot = {
      latestDate,
      payload,
    };

    setPublicCache(res);

    return res.status(200).json(payload);
  } catch (e) {
    console.error("[wr-api] /api/latest-stats-snapshot error:", e);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
