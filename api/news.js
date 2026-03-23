import { and, desc, eq, inArray, sql } from "drizzle-orm";

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

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getArticlePayload(articleRow) {
  return articleRow?.rawPayload && typeof articleRow.rawPayload === "object"
    ? articleRow.rawPayload
    : {};
}

function summarizeArticle(articleRow, eventRows = []) {
  const payload = getArticlePayload(articleRow);
  const itemChanges = Array.isArray(payload.itemChanges) ? payload.itemChanges : [];
  const skins = Array.isArray(payload.skins) ? payload.skins : [];
  const newChampions = Array.isArray(payload.newChampions) ? payload.newChampions : [];
  const championChanges = Array.isArray(payload.championChanges) ? payload.championChanges : [];

  return {
    id: articleRow.id,
    sourceUrl: articleRow.sourceUrl,
    normalizedUrl: articleRow.normalizedUrl,
    title: articleRow.title,
    description: articleRow.description,
    category: articleRow.category,
    locale: articleRow.locale,
    publishedAt: toIso(articleRow.publishedAt),
    patchVersion: payload.patchVersion || null,
    patchPublishedAt: toIso(payload.patchPublishedAt || articleRow.publishedAt),
    pageType: payload.pageType || null,
    bannerImageUrl: payload.bannerImageUrl || null,
    counts: {
      events: eventRows.length,
      itemChanges: itemChanges.length,
      skins: skins.length,
      newChampions: newChampions.length,
      championChanges: championChanges.length,
    },
    eventsPreview: eventRows.slice(0, 3).map((event) => ({
      id: event.id,
      date: event.eventDate,
      championSlug: event.championSlug,
      type: event.eventType,
      scope: event.scope,
      title: event.title,
      summary: clipText(event.summary, 180),
    })),
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
    const limit = parsePositiveInt(req.query.limit, 24, 100);
    const offset = parsePositiveInt(req.query.offset, 0, 1000);
    const locale =
      typeof req.query.locale === "string" && req.query.locale.trim()
        ? req.query.locale.trim()
        : null;
    const category =
      typeof req.query.category === "string" && req.query.category.trim()
        ? req.query.category.trim()
        : null;

    const conditions = [];
    if (locale) conditions.push(eq(newsArticles.locale, locale));
    if (category) conditions.push(eq(newsArticles.category, category));
    const whereClause = conditions.length ? and(...conditions) : undefined;

    const articleRows = await db
      .select()
      .from(newsArticles)
      .where(whereClause)
      .orderBy(desc(newsArticles.publishedAt), desc(newsArticles.id))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(newsArticles)
      .where(whereClause);

    const articleIds = articleRows.map((article) => article.id);
    const eventRows = articleIds.length
      ? await db
          .select({
            id: championEvents.id,
            articleId: championEvents.articleId,
            eventDate: championEvents.eventDate,
            championSlug: championEvents.championSlug,
            eventType: championEvents.eventType,
            scope: championEvents.scope,
            title: championEvents.title,
            summary: championEvents.summary,
          })
          .from(championEvents)
          .where(inArray(championEvents.articleId, articleIds))
          .orderBy(desc(championEvents.eventDate), desc(championEvents.id))
      : [];

    const eventsByArticleId = eventRows.reduce((acc, row) => {
      if (!acc[row.articleId]) acc[row.articleId] = [];
      acc[row.articleId].push({
        ...row,
        eventDate: row.eventDate ? String(row.eventDate) : null,
      });
      return acc;
    }, {});

    const items = articleRows.map((article) =>
      summarizeArticle(article, eventsByArticleId[article.id] || []),
    );

    setPublicCache(res);
    return res.status(200).json({
      count: items.length,
      total: totalRows[0]?.count || 0,
      limit,
      offset,
      items,
    });
  } catch (error) {
    console.error("[wr-api] /api/news error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
