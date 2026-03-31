import { and, eq, or } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  guideAbilities,
  guideBuildBreakdowns,
  guideEntities,
  guideOfficialMeta,
  guideSummaries,
  guideVariantMatchups,
  guideVariantSections,
  guideVariantSkillOrders,
  guideVariantSkillRows,
  guideVariants,
} from "../db/schema.js";
import { assembleGuideDetail, collectGuideEntityRefs } from "../lib/guides.mjs";
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

  const slug = String(req.params?.slug || "").trim();

  if (!slug) {
    setNoStore(res);
    return res.status(400).json({ error: "Missing slug" });
  }

  try {
    const summaryRows = await db
      .select()
      .from(guideSummaries)
      .where(eq(guideSummaries.slug, slug))
      .limit(1);

    if (!summaryRows.length) {
      setNoStore(res);
      return res.status(404).json({ error: "Not Found" });
    }

    const [officialMetaRows, abilityRows, buildBreakdownRows, variantRows, sectionRows, skillOrderRows, skillRowRows, matchupRows] =
      await Promise.all([
        db.select().from(guideOfficialMeta).where(eq(guideOfficialMeta.guideSlug, slug)),
        db.select().from(guideAbilities).where(eq(guideAbilities.guideSlug, slug)),
        db
          .select()
          .from(guideBuildBreakdowns)
          .where(eq(guideBuildBreakdowns.guideSlug, slug)),
        db.select().from(guideVariants).where(eq(guideVariants.guideSlug, slug)),
        db.select().from(guideVariantSections).where(eq(guideVariantSections.guideSlug, slug)),
        db
          .select()
          .from(guideVariantSkillOrders)
          .where(eq(guideVariantSkillOrders.guideSlug, slug)),
        db.select().from(guideVariantSkillRows).where(eq(guideVariantSkillRows.guideSlug, slug)),
        db.select().from(guideVariantMatchups).where(eq(guideVariantMatchups.guideSlug, slug)),
      ]);

    const entityRefs = collectGuideEntityRefs({
      abilities: abilityRows,
      buildBreakdown: buildBreakdownRows[0] || null,
      sections: sectionRows,
      skillOrders: skillOrderRows,
      skillRows: skillRowRows,
      matchups: matchupRows,
    });

    const entityRows = entityRefs.length
      ? await db
          .select()
          .from(guideEntities)
          .where(
            or(
              ...entityRefs.map((ref) =>
                and(eq(guideEntities.kind, ref.kind), eq(guideEntities.slug, ref.slug)),
              ),
            ),
          )
      : [];

    const detail = assembleGuideDetail({
      summary: summaryRows[0],
      officialMeta: officialMetaRows[0] || null,
      abilities: abilityRows,
      buildBreakdown: buildBreakdownRows[0] || null,
      variants: variantRows,
      sections: sectionRows,
      skillOrders: skillOrderRows,
      skillRows: skillRowRows,
      matchups: matchupRows,
      entities: entityRows,
    });

    setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
    return res.status(200).json(detail);
  } catch (error) {
    console.error("[wr-api] /api/guides/:slug error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
