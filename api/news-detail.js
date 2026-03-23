import { asc, desc, eq } from "drizzle-orm";

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

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseArticleId(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error("Invalid article id");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const articleId = parseArticleId(req.params?.id);

    const articleRows = await db
      .select()
      .from(newsArticles)
      .where(eq(newsArticles.id, articleId))
      .limit(1);

    const article = articleRows[0];
    if (!article) {
      setNoStore(res);
      return res.status(404).json({ error: "Not Found" });
    }

    const eventRows = await db
      .select()
      .from(championEvents)
      .where(eq(championEvents.articleId, articleId))
      .orderBy(desc(championEvents.eventDate), asc(championEvents.id));

    const payload =
      article.rawPayload && typeof article.rawPayload === "object" ? article.rawPayload : {};

    setPublicCache(res);
    return res.status(200).json({
      article: {
        id: article.id,
        sourceUrl: article.sourceUrl,
        normalizedUrl: article.normalizedUrl,
        title: article.title,
        description: article.description,
        category: article.category,
        locale: article.locale,
        publishedAt: toIso(article.publishedAt),
        contentId: article.contentId,
        bodyText: article.bodyText,
        rawPayload: payload,
        patchVersion: payload.patchVersion || null,
        patchPublishedAt: toIso(payload.patchPublishedAt || article.publishedAt),
        counts: {
          events: eventRows.length,
          itemChanges: Array.isArray(payload.itemChanges) ? payload.itemChanges.length : 0,
          skins: Array.isArray(payload.skins) ? payload.skins.length : 0,
          newChampions: Array.isArray(payload.newChampions) ? payload.newChampions.length : 0,
          championChanges: Array.isArray(payload.championChanges)
            ? payload.championChanges.length
            : 0,
        },
      },
      events: eventRows.map((row) => ({
        id: row.id,
        date: row.eventDate ? String(row.eventDate) : null,
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
      })),
    });
  } catch (error) {
    console.error("[wr-api] /api/news/:id error:", error);
    const statusCode =
      error?.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
    setNoStore(res);
    return res.status(statusCode).json({
      error: statusCode === 400 ? "Bad Request" : "Internal Server Error",
    });
  }
}
