import { eq } from "drizzle-orm";

import { db } from "../db/client.js";
import { championGuides } from "../db/schema.js";
import { summarizeGuide } from "../lib/guides.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function isImportAuthorized(req) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const headerSecret = String(req.headers["x-guides-sync-secret"] || "").trim();

  const expectedToken = String(process.env.GUIDES_SYNC_TOKEN || "").trim();
  const expectedSecret = String(process.env.GUIDES_SYNC_SECRET || "").trim();

  if (expectedToken && bearerToken === expectedToken) return true;
  if (expectedSecret && headerSecret === expectedSecret) return true;

  return false;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!isImportAuthorized(req)) {
    setNoStore(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const guide = req.body?.guide;

  if (!guide?.champion?.slug || !guide?.champion?.name) {
    setNoStore(res);
    return res.status(400).json({ error: "Invalid guide payload" });
  }

  try {
    const summary = summarizeGuide(guide);
    const now = new Date();

    const existing = await db
      .select({ slug: championGuides.slug })
      .from(championGuides)
      .where(eq(championGuides.slug, summary.slug))
      .limit(1);

    if (existing.length) {
      await db
        .update(championGuides)
        .set({
          name: summary.name,
          title: summary.title,
          icon: summary.icon,
          patch: summary.patch,
          tier: summary.tier,
          recommendedRole: summary.recommendedRole,
          roles: summary.roles,
          buildCount: summary.buildCount,
          sourceSite: summary.sourceSite,
          sourceUrl: summary.sourceUrl,
          contentHash: summary.contentHash,
          fetchedAt: summary.fetchedAt ? new Date(summary.fetchedAt) : now,
          payload: guide,
          updatedAt: now,
        })
        .where(eq(championGuides.slug, summary.slug));
    } else {
      await db.insert(championGuides).values({
        slug: summary.slug,
        name: summary.name,
        title: summary.title,
        icon: summary.icon,
        patch: summary.patch,
        tier: summary.tier,
        recommendedRole: summary.recommendedRole,
        roles: summary.roles,
        buildCount: summary.buildCount,
        sourceSite: summary.sourceSite,
        sourceUrl: summary.sourceUrl,
        contentHash: summary.contentHash,
        fetchedAt: summary.fetchedAt ? new Date(summary.fetchedAt) : now,
        payload: guide,
        createdAt: now,
        updatedAt: now,
      });
    }

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      slug: summary.slug,
      updatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[wr-api] /api/guides/import error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
