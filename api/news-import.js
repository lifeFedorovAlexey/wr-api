import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { championEvents, champions, newsArticles } from "../db/schema.js";
import { normalizeNewsImportPayload } from "../lib/newsImport.mjs";
import { ensureAuthorized } from "./utils/adminAuth.js";
import { AUTH_PROFILES } from "./utils/authProfiles.js";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!ensureAuthorized(req, res, AUTH_PROFILES.newsSync)) {
    return;
  }

  try {
    const championRows = await db.select().from(champions);
    const { article, events } = normalizeNewsImportPayload({
      body: req.body,
      championRows,
    });
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      const articleRows = await tx
        .insert(newsArticles)
        .values({
          sourceUrl: article.sourceUrl,
          normalizedUrl: article.normalizedUrl,
          title: article.title,
          description: article.description,
          category: article.category,
          locale: article.locale,
          publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
          contentId: article.contentId,
          bodyText: article.bodyText,
          rawPayload: article.rawPayload,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: newsArticles.sourceUrl,
          set: {
            normalizedUrl: article.normalizedUrl,
            title: article.title,
            description: article.description,
            category: article.category,
            locale: article.locale,
            publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
            contentId: article.contentId,
            bodyText: article.bodyText,
            rawPayload: article.rawPayload,
            updatedAt: now,
          },
        })
        .returning({
          id: newsArticles.id,
          sourceUrl: newsArticles.sourceUrl,
        });

      const articleId = articleRows[0]?.id;
      if (!articleId) {
        throw new Error("Failed to upsert news article");
      }

      await tx.delete(championEvents).where(eq(championEvents.articleId, articleId));

      if (events.length) {
        await tx.insert(championEvents).values(
          events.map((event) => ({
            articleId,
            eventDate: event.eventDate,
            championSlug: event.championSlug,
            eventType: event.eventType,
            scope: event.scope,
            abilityName: event.abilityName || null,
            skinName: event.skinName || null,
            title: event.title || null,
            summary: event.summary || null,
            details: event.details || {},
            confidence: event.confidence,
            sourceMethod: event.sourceMethod,
            dedupeKey: event.dedupeKey,
            updatedAt: now,
          })),
        );
      }

      return {
        articleId,
        eventsCount: events.length,
      };
    });

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      articleId: result.articleId,
      sourceUrl: article.sourceUrl,
      eventsCount: result.eventsCount,
      updatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[wr-api] /api/news/import error:", error);
    setNoStore(res);
    const statusCode =
      error?.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: statusCode === 400 ? "Bad Request" : "Internal Server Error",
    });
  }
}
