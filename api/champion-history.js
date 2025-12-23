import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

function setPublicCache(res, { sMaxAge = 60, swr = 300 } = {}) {
  // Vercel CDN уважает s-maxage для API Routes.
  // Ключ кеша включает полный URL (path + query), так что разные фильтры не мешают друг другу.
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`
  );
}

function setNoStore(res) {
  // Не кешируем ошибки/валидацию — иначе можно словить "вечный" 400 на CDN.
  res.setHeader("Cache-Control", "no-store");
}

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
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { slug, rank, lane, date, from, to, latest } = req.query;

  try {
    const safeSlug =
      typeof slug === "string" && slug.trim() ? slug.trim() : null;

    if (safeSlug && safeSlug.length > 64) {
      setNoStore(res);
      return res.status(400).json({ error: "Invalid slug" });
    }

    const rankList = splitListParam(rank, 10);
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

    // WHERE без дат (нужно для latest=1)
    const baseConditions = [];

    if (safeSlug) baseConditions.push(eq(championStatsHistory.slug, safeSlug));
    if (rankList && rankList.length > 0) {
      baseConditions.push(inArray(championStatsHistory.rank, rankList));
    }
    if (laneList && laneList.length > 0) {
      baseConditions.push(inArray(championStatsHistory.lane, laneList));
    }

    const baseWhere = baseConditions.length
      ? and(...baseConditions)
      : undefined;

    // ✅ latest=1: если даты не заданы — берём максимальную дату и режем по ней
    const wantLatest = String(latest) === "1" || String(latest) === "true";
    if (wantLatest && !fromDate && !toDate) {
      const maxRow = await db
        .select({
          maxDate: sql`max(${championStatsHistory.date})`.as("maxDate"),
        })
        .from(championStatsHistory)
        .where(baseWhere);

      const maxDateRaw = maxRow?.[0]?.maxDate ?? null;
      const maxDateStr = toDateString(maxDateRaw);

      if (maxDateStr) {
        fromDate = maxDateStr;
        toDate = maxDateStr;
      }
    }

    // WHERE с датами
    const conditions = [...baseConditions];

    if (fromDate) {
      conditions.push(gte(championStatsHistory.date, sql`${fromDate}::date`));
    }
    if (toDate) {
      conditions.push(lte(championStatsHistory.date, sql`${toDate}::date`));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

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

    // Кеш общий (CDN), а не "на пользователя": ключ = полный URL запроса.
    // Подбирай TTL по частоте обновления твоих данных.
    setPublicCache(res, { sMaxAge: 300, swr: 1800 });

    return res.status(200).json({
      filters: {
        slug: safeSlug || null,
        rank: rankList,
        lane: laneList,
        from: fromDate,
        to: toDate || (fromDate && !toDate ? fromDate : toDate),
        latest: wantLatest || null,
      },
      count: items.length,
      items,
    });
  } catch (e) {
    const status =
      e?.statusCode && Number.isInteger(e.statusCode) ? e.statusCode : 500;
    console.error("[wr-api] /api/champion-history error:", e);
    setNoStore(res);
    return res.status(status).json({
      error: status === 400 ? "Bad Request" : "Internal Server Error",
    });
  }
}
