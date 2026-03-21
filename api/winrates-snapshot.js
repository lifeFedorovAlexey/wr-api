import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

import { desc, inArray, sql } from "drizzle-orm";

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

    if (!recentDates.length) {
      setPublicCache(res);
      return res.status(200).json({
        count: 0,
        dates: [],
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
      .where(
        inArray(
          sql`to_char(${championStatsHistory.date}, 'YYYY-MM-DD')`,
          recentDates,
        ),
      );

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
      count: items.length,
      dates: recentDates,
      items,
    });
  } catch (e) {
    console.error("[wr-api] /api/winrates-snapshot error:", e);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
