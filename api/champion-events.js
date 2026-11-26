import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "../db/client.js";
import { championEvents, newsArticles } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

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
  const date = new Date(str);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseDateParam(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const error = new Error("Invalid date format. Use YYYY-MM-DD.");
    error.statusCode = 400;
    throw error;
  }
  return trimmed;
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : null;
    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);
    const type = typeof req.query.type === "string" ? req.query.type.trim() : null;
    const groupBy = req.query.groupBy === "date" ? "date" : "none";
    const limit = parsePositiveInt(req.query.limit, 100, 500);

    const conditions = [];

    if (slug) conditions.push(eq(championEvents.championSlug, slug));
    if (type) conditions.push(eq(championEvents.eventType, type));
    if (from) conditions.push(gte(championEvents.eventDate, sql`${from}::date`));
    if (to) conditions.push(lte(championEvents.eventDate, sql`${to}::date`));

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: championEvents.id,
        eventDate: championEvents.eventDate,
        championSlug: championEvents.championSlug,
        eventType: championEvents.eventType,
        scope: championEvents.scope,
        abilityName: championEvents.abilityName,
        skinName: championEvents.skinName,
        title: championEvents.title,
        summary: championEvents.summary,
        details: championEvents.details,
        confidence: championEvents.confidence,
        sourceMethod: championEvents.sourceMethod,
        articleId: championEvents.articleId,
        articleSourceUrl: newsArticles.sourceUrl,
        articleTitle: newsArticles.title,
        articlePublishedAt: newsArticles.publishedAt,
        articleCategory: newsArticles.category,
      })
      .from(championEvents)
      .innerJoin(newsArticles, eq(championEvents.articleId, newsArticles.id))
      .where(whereClause)
      .orderBy(desc(championEvents.eventDate), asc(championEvents.id))
      .limit(limit);

    const items = rows.map((row) => ({
      id: row.id,
      date: toDateString(row.eventDate),
      championSlug: row.championSlug,
      type: row.eventType,
      scope: row.scope,
      abilityName: row.abilityName,
      skinName: row.skinName,
      title: row.title,
      summary: row.summary,
      details: row.details,
      confidence: row.confidence,
      sourceMethod: row.sourceMethod,
      article: {
        id: row.articleId,
        sourceUrl: row.articleSourceUrl,
        title: row.articleTitle,
        publishedAt: row.articlePublishedAt ? new Date(row.articlePublishedAt).toISOString() : null,
        category: row.articleCategory,
      },
    }));

    const days =
      groupBy === "date"
        ? items.reduce((acc, item) => {
            const date = item.date || "unknown";
            let group = acc.find((entry) => entry.date === date);
            if (!group) {
              group = { date, items: [] };
              acc.push(group);
            }
            group.items.push(item);
            return acc;
          }, [])
        : null;

    setPublicCache(res);
    return res.status(200).json({
      filters: {
        slug,
        from,
        to,
        type,
        limit,
        groupBy: groupBy === "date" ? "date" : null,
      },
      count: items.length,
      items,
      days,
    });
  } catch (error) {
    console.error("[wr-api] /api/champion-events error:", error);
    const statusCode =
      error?.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
    setNoStore(res);
    return res.status(statusCode).json({
      error: statusCode === 400 ? "Bad Request" : "Internal Server Error",
    });
  }
}
