import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

import { desc, eq, sql } from "drizzle-orm";

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

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const latestRow = await db
      .select({ date: championStatsHistory.date })
      .from(championStatsHistory)
      .orderBy(desc(championStatsHistory.date))
      .limit(1);

    const latestDate = latestRow.length
      ? toDateString(latestRow[0].date)
      : null;

    if (!latestDate) {
      setPublicCache(res);
      return res.status(200).json({
        filters: { date: null },
        count: 0,
        items: [],
      });
    }

    const rows = await db
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
      .where(eq(championStatsHistory.date, sql`${latestDate}::date`));

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

    setPublicCache(res);

    return res.status(200).json({
      filters: { date: latestDate },
      count: items.length,
      items,
    });
  } catch (e) {
    console.error("[wr-api] /api/latest-stats-snapshot error:", e);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
