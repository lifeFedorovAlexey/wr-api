import { asc } from "drizzle-orm";

import { db } from "../db/client.js";
import { guideSummaries, riftggCnBuilds, riftggCnMatchups } from "../db/schema.js";
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

async function buildGuideLaneMap() {
  const [matchupRows, buildRows] = await Promise.all([
    db
      .select({
        slug: riftggCnMatchups.championSlug,
        lane: riftggCnMatchups.lane,
      })
      .from(riftggCnMatchups),
    db
      .select({
        slug: riftggCnBuilds.championSlug,
        lane: riftggCnBuilds.lane,
      })
      .from(riftggCnBuilds),
  ]);

  const laneMap = new Map();

  for (const row of [...matchupRows, ...buildRows]) {
    const slug = String(row?.slug || "").trim();
    const lane = String(row?.lane || "").trim();
    if (!slug || !lane) continue;

    const current = laneMap.get(slug) || new Set();
    current.add(lane);
    laneMap.set(slug, current);
  }

  return laneMap;
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

    const rows =
      fields === "slug"
        ? await db
            .select({
              slug: guideSummaries.slug,
            })
            .from(guideSummaries)
            .orderBy(asc(guideSummaries.name))
        : await db
            .select({
              slug: guideSummaries.slug,
              name: guideSummaries.name,
              title: guideSummaries.title,
              icon: guideSummaries.icon,
              patch: guideSummaries.patch,
              tier: guideSummaries.tier,
              recommendedRole: guideSummaries.recommendedRole,
              roles: guideSummaries.roles,
              buildCount: guideSummaries.buildCount,
              updatedAt: guideSummaries.updatedAt,
            })
            .from(guideSummaries)
            .orderBy(asc(guideSummaries.name));
    const guideLaneMap = fields === "slug" ? new Map() : await buildGuideLaneMap();

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
      availableLanes: Array.from(guideLaneMap.get(row.slug) || []),
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
