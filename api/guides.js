import { asc } from "drizzle-orm";

import { db } from "../db/client.js";
import { guideSummaries } from "../db/schema.js";
import { buildPublicIconPath } from "../lib/championIcons.mjs";
import { setCors } from "./utils/cors.js";

function setPublicCache(res, { sMaxAge = 3600, swr = 21600 } = {}) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
  );
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const fields = typeof req.query.fields === "string" ? req.query.fields.trim() : "";

    const rows = await db
      .select()
      .from(guideSummaries)
      .orderBy(asc(guideSummaries.name));

    if (fields === "slug") {
      setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
      return res.status(200).json(rows.map((row) => row.slug).filter(Boolean));
    }

    const items = rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      title: row.title,
      iconUrl: row.icon ? buildPublicIconPath(row.slug, row.icon) : null,
      patch: row.patch,
      tier: row.tier,
      recommendedRole: row.recommendedRole,
      roles: Array.isArray(row.roles) ? row.roles : [],
      buildCount: row.buildCount || 1,
      updatedAt: row.updatedAt,
    }));

    setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
    return res.status(200).json({
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("[wr-api] /api/guides error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
