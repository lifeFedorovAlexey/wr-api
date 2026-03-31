import { db } from "../db/client.js";
import { championStatsHistory, champions } from "../db/schema.js";
import { buildDateInFilter } from "./utils/dateFilters.js";
import { setCors } from "./utils/cors.js";

import { desc } from "drizzle-orm";
import { buildPublicIconPath } from "../lib/championIcons.mjs";

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

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getChampionName(champion) {
  if (!champion) return "";

  const localizations = champion.nameLocalizations || {};
  return (
    localizations.ru_ru ||
    localizations.en_us ||
    champion.name ||
    champion.slug ||
    ""
  );
}

function strengthToTier(level) {
  if (level == null) return { label: "—", color: "#94a3b8" };

  switch (level) {
    case 0:
      return { label: "S+", color: "#fb7185" };
    case 1:
      return { label: "S", color: "#f97316" };
    case 2:
      return { label: "A", color: "#facc15" };
    case 3:
      return { label: "B", color: "#4ade80" };
    case 4:
      return { label: "C", color: "#7dd3fc" };
    default:
      return { label: "D", color: "#94a3b8" };
  }
}

function groupHistoryBySlice(items) {
  const sliceMap = {};

  for (const item of items) {
    if (!item?.rank || !item?.lane || !item?.slug || !item?.date) continue;

    const sliceKey = `${item.rank}|${item.lane}`;
    if (!sliceMap[sliceKey]) {
      sliceMap[sliceKey] = [];
    }

    sliceMap[sliceKey].push(item);
  }

  return sliceMap;
}

function getRecentDates(items, limit = 7) {
  return [...new Set(items.map((item) => String(item.date)))].sort().slice(-limit);
}

function getSeriesDelta(values) {
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (finite.length < 2) return null;
  return Number((finite[finite.length - 1] - finite[0]).toFixed(2));
}

function buildPreparedRowsBySlice({ championRows, historyItems }) {
  const championBySlug = {};
  for (const champion of championRows) {
    if (!champion?.slug) continue;
    championBySlug[champion.slug] = champion;
  }

  const sliceMap = groupHistoryBySlice(historyItems);
  const rowsBySlice = {};
  let maxRowCount = 0;

  for (const [sliceKey, sliceItems] of Object.entries(sliceMap)) {
    const recentDates = getRecentDates(sliceItems, 7);
    const latestDate = recentDates[recentDates.length - 1] ?? null;
    if (!latestDate) {
      rowsBySlice[sliceKey] = [];
      continue;
    }

    const itemsBySlug = new Map();
    for (const item of sliceItems) {
      if (!recentDates.includes(String(item.date))) continue;
      const slug = item.slug;
      const history = itemsBySlug.get(slug) || new Map();
      history.set(String(item.date), item);
      itemsBySlug.set(slug, history);
    }

    const latestRows = sliceItems
      .filter((item) => String(item.date) === latestDate)
      .sort(
        (left, right) =>
          (left.position ?? Number.POSITIVE_INFINITY) -
          (right.position ?? Number.POSITIVE_INFINITY),
      );

    const preparedRows = latestRows.map((item) => {
      const champion = championBySlug[item.slug] || null;
      const historyByDate = itemsBySlug.get(item.slug) || new Map();
      const tier = strengthToTier(item.strengthLevel ?? null);

      const winRateTrend = recentDates.map((date) => {
        const row = historyByDate.get(date);
        return typeof row?.winRate === "number" ? Number(row.winRate.toFixed(2)) : null;
      });
      const pickRateTrend = recentDates.map((date) => {
        const row = historyByDate.get(date);
        return typeof row?.pickRate === "number" ? Number(row.pickRate.toFixed(2)) : null;
      });
      const banRateTrend = recentDates.map((date) => {
        const row = historyByDate.get(date);
        return typeof row?.banRate === "number" ? Number(row.banRate.toFixed(2)) : null;
      });

      const winRateDelta = getSeriesDelta(winRateTrend);
      const pickRateDelta = getSeriesDelta(pickRateTrend);
      const banRateDelta = getSeriesDelta(banRateTrend);

      return {
        slug: item.slug,
        name: getChampionName(champion),
        icon:
          champion?.icon && champion?.slug
            ? buildPublicIconPath(champion.slug, champion.icon)
            : null,
        winRate: item.winRate ?? null,
        pickRate: item.pickRate ?? null,
        banRate: item.banRate ?? null,
        strengthLevel: item.strengthLevel ?? null,
        tierLabel: tier.label,
        tierColor: tier.color,
        positionDelta: winRateDelta,
        positionTrend: winRateTrend,
        winRateDelta,
        pickRateDelta,
        banRateDelta,
        winRateTrend,
        pickRateTrend,
        banRateTrend,
      };
    });

    rowsBySlice[sliceKey] = preparedRows;
    if (preparedRows.length > maxRowCount) {
      maxRowCount = preparedRows.length;
    }
  }

  return { rowsBySlice, maxRowCount };
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const recentDatesRows = await db
      .selectDistinct({
        date: championStatsHistory.date,
      })
      .from(championStatsHistory)
      .orderBy(desc(championStatsHistory.date))
      .limit(7);

    const recentDates = recentDatesRows
      .map((row) => toDateString(row.date))
      .filter(Boolean)
      .sort();
    const latestDate = recentDates[recentDates.length - 1] ?? null;

    if (cachedSnapshot && cachedSnapshot.latestDate === latestDate) {
      setPublicCache(res);
      return res.status(200).json(cachedSnapshot.payload);
    }

    if (!recentDates.length) {
      const emptyPayload = {
        count: 0,
        dates: [],
        items: [],
        rowsBySlice: {},
        maxRowCount: 0,
      };
      cachedSnapshot = {
        latestDate: null,
        payload: emptyPayload,
      };
      setPublicCache(res);
      return res.status(200).json(emptyPayload);
    }

    const [rows, championRows] = await Promise.all([
      db
        .select({
          date: championStatsHistory.date,
          slug: championStatsHistory.slug,
          rank: championStatsHistory.rank,
          lane: championStatsHistory.lane,
          position: championStatsHistory.position,
          winRate: championStatsHistory.winRate,
          pickRate: championStatsHistory.pickRate,
          banRate: championStatsHistory.banRate,
          strengthLevel: championStatsHistory.strengthLevel,
        })
        .from(championStatsHistory)
        .where(buildDateInFilter(championStatsHistory.date, recentDates)),
      db.select().from(champions),
    ]);

    const items = rows.map((row) => ({
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

    const { rowsBySlice, maxRowCount } = buildPreparedRowsBySlice({
      championRows,
      historyItems: items,
    });

    const payload = {
      count: items.length,
      dates: recentDates,
      items,
      rowsBySlice,
      maxRowCount,
    };

    cachedSnapshot = {
      latestDate,
      payload,
    };

    setPublicCache(res);

    return res.status(200).json(payload);
  } catch (e) {
    console.error("[wr-api] /api/winrates-snapshot error:", e);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
