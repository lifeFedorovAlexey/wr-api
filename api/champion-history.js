// api/champion-history.js
import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

// Простейший нормалайзер дат: Date -> 'YYYY-MM-DD'
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

function splitListParam(v, maxItems) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  const arr = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (arr.length > maxItems) {
    const err = new Error(`Too many values (max ${maxItems})`);
    err.statusCode = 400;
    throw err;
  }

  return arr.length ? arr : null;
}

function parseDateParam(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error("Invalid date format. Use YYYY-MM-DD.");
    err.statusCode = 400;
    throw err;
  }
  return s;
}

export default async function handler(req, res) {
  // CORS через util
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { slug, rank, lane, date, from, to } = req.query;

  try {
    // 1) Валидация и нормализация фильтров (выходной формат сохраняем)
    const safeSlug =
      typeof slug === "string" && slug.trim() ? slug.trim() : null;

    if (safeSlug && safeSlug.length > 64) {
      return res.status(400).json({ error: "Invalid slug" });
    }

    const rankList = splitListParam(rank, 10); // не даём прислать мегасписи
    const laneList = splitListParam(lane, 10);

    let fromDate = null;
    let toDate = null;

    const dateOne = parseDateParam(date);
    if (dateOne) {
      fromDate = dateOne;
      toDate = dateOne;
    } else {
      fromDate = parseDateParam(from);
      toDate = parseDateParam(to);
    }

    // 2) Собираем WHERE в SQL (вместо rows.filter)
    const conditions = [];

    if (safeSlug) {
      conditions.push(eq(championStatsHistory.slug, safeSlug));
    }

    if (rankList && rankList.length > 0) {
      conditions.push(inArray(championStatsHistory.rank, rankList));
    }

    if (laneList && laneList.length > 0) {
      conditions.push(inArray(championStatsHistory.lane, laneList));
    }

    // date диапазон (колонка date), сравнение через ::date чтобы не было сюрпризов
    if (fromDate) {
      conditions.push(gte(championStatsHistory.date, sql`${fromDate}::date`));
    }
    if (toDate) {
      conditions.push(lte(championStatsHistory.date, sql`${toDate}::date`));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    // 3) Запрос сразу отсортированный в БД
    const rows = await db
      .select()
      .from(championStatsHistory)
      .where(whereClause)
      .orderBy(
        asc(championStatsHistory.date),
        asc(championStatsHistory.slug),
        asc(championStatsHistory.rank),
        asc(championStatsHistory.lane)
      );

    // 4) Формат ответа — как у тебя
    const items = rows.map((row) => ({
      date: toDateString(row.date),
      slug: row.slug,
      cnHeroId: row.cnHeroId,
      rank: row.rank,
      lane: row.lane,
      position: row.position,
      winRate: row.winRate,
      pickRate: row.pickRate,
      banRate: row.banRate,
      strengthLevel: row.strengthLevel,
    }));

    return res.status(200).json({
      filters: {
        slug: safeSlug || null,
        rank: rankList,
        lane: laneList,
        from: fromDate,
        to: toDate || (fromDate && !toDate ? fromDate : toDate),
      },
      count: items.length,
      items,
    });
  } catch (e) {
    const status =
      e?.statusCode && Number.isInteger(e.statusCode) ? e.statusCode : 500;
    console.error("[wr-api] /api/champion-history error:", e);
    return res.status(status).json({
      error: status === 400 ? "Bad Request" : "Internal Server Error",
    });
  }
}
