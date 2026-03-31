import { and, eq, inArray, or } from "drizzle-orm";

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
  champions,
  riftggCnBuilds,
  riftggCnDictionaries,
  riftggCnMatchups,
} from "../db/schema.js";
import { assembleGuideDetail, collectGuideEntityRefs } from "../lib/guides.mjs";
import { buildRiftGgGuidePayload } from "../lib/riftggCnStats.mjs";
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
    const mergeRiftDictionaryAssets = (rows, assetRowsBySlug) =>
      rows.map((row) => {
        const assetRow = assetRowsBySlug.get(row.slug);
        if (!assetRow) return row;

        return {
          ...row,
          imageUrl: assetRow.imageUrl || null,
          tooltipImageUrl: assetRow.tooltipImageUrl || null,
          rawPayload: {
            ...(row.rawPayload || {}),
            imageUrl: assetRow.imageUrl || null,
            tooltipImageUrl: assetRow.tooltipImageUrl || null,
          },
        };
      });

    const summaryRows = await db
      .select()
      .from(guideSummaries)
      .where(eq(guideSummaries.slug, slug))
      .limit(1);

    if (!summaryRows.length) {
      setNoStore(res);
      return res.status(404).json({ error: "Not Found" });
    }

    const [officialMetaRows, abilityRows, buildBreakdownRows, variantRows, sectionRows, skillOrderRows, skillRowRows, matchupRows, riftggMatchupRows, riftggBuildRows] =
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
        db.select().from(riftggCnMatchups).where(eq(riftggCnMatchups.championSlug, slug)),
        db.select().from(riftggCnBuilds).where(eq(riftggCnBuilds.championSlug, slug)),
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

    const opponentSlugs = Array.from(
      new Set(riftggMatchupRows.map((row) => row.opponentSlug).filter(Boolean)),
    );
    const dictionarySlugs = {
      item: Array.from(
        new Set(
          riftggBuildRows
            .filter((row) => row.buildType === "coreItems")
            .flatMap((row) => row.entrySlugs || [])
            .filter(Boolean),
        ),
      ),
      rune: Array.from(
        new Set(
          riftggBuildRows
            .filter((row) => row.buildType === "runes")
            .flatMap((row) => row.entrySlugs || [])
            .filter(Boolean),
        ),
      ),
      spell: Array.from(
        new Set(
          riftggBuildRows
            .filter((row) => row.buildType === "spells")
            .flatMap((row) => row.entrySlugs || [])
            .filter(Boolean),
        ),
      ),
    };
    const riftDictionaryEntityRefs = [
      ...dictionarySlugs.item.map((value) => ({ kind: "item", slug: value })),
      ...dictionarySlugs.rune.map((value) => ({ kind: "rune", slug: value })),
      ...dictionarySlugs.spell.map((value) => ({ kind: "summonerSpell", slug: value })),
    ];

    const [opponentRows, itemRowsRaw, runeRowsRaw, spellRowsRaw, riftDictionaryAssetRows] = await Promise.all([
      opponentSlugs.length
        ? db.select().from(champions).where(inArray(champions.slug, opponentSlugs))
        : Promise.resolve([]),
      dictionarySlugs.item.length
        ? db
            .select()
            .from(riftggCnDictionaries)
            .where(
              and(
                eq(riftggCnDictionaries.kind, "item"),
                inArray(riftggCnDictionaries.slug, dictionarySlugs.item),
              ),
            )
        : Promise.resolve([]),
      dictionarySlugs.rune.length
        ? db
            .select()
            .from(riftggCnDictionaries)
            .where(
              and(
                eq(riftggCnDictionaries.kind, "rune"),
                inArray(riftggCnDictionaries.slug, dictionarySlugs.rune),
              ),
            )
        : Promise.resolve([]),
      dictionarySlugs.spell.length
        ? db
            .select()
            .from(riftggCnDictionaries)
            .where(
              and(
                eq(riftggCnDictionaries.kind, "spell"),
                inArray(riftggCnDictionaries.slug, dictionarySlugs.spell),
              ),
            )
        : Promise.resolve([]),
      riftDictionaryEntityRefs.length
        ? db
            .select({
              kind: guideEntities.kind,
              slug: guideEntities.slug,
              imageUrl: guideEntities.imageUrl,
              tooltipImageUrl: guideEntities.tooltipImageUrl,
            })
            .from(guideEntities)
            .where(
              or(
                ...riftDictionaryEntityRefs.map((ref) =>
                  and(eq(guideEntities.kind, ref.kind), eq(guideEntities.slug, ref.slug)),
                ),
              ),
            )
        : Promise.resolve([]),
    ]);
    const itemAssetRowsBySlug = new Map(
      riftDictionaryAssetRows
        .filter((row) => row.kind === "item")
        .map((row) => [row.slug, row]),
    );
    const runeAssetRowsBySlug = new Map(
      riftDictionaryAssetRows
        .filter((row) => row.kind === "rune")
        .map((row) => [row.slug, row]),
    );
    const spellAssetRowsBySlug = new Map(
      riftDictionaryAssetRows
        .filter((row) => row.kind === "summonerSpell")
        .map((row) => [row.slug, row]),
    );
    const itemRows = mergeRiftDictionaryAssets(itemRowsRaw, itemAssetRowsBySlug);
    const runeRows = mergeRiftDictionaryAssets(runeRowsRaw, runeAssetRowsBySlug);
    const spellRows = mergeRiftDictionaryAssets(spellRowsRaw, spellAssetRowsBySlug);

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

    detail.riftgg = buildRiftGgGuidePayload({
      matchupRows: riftggMatchupRows,
      buildRows: riftggBuildRows,
      opponentRows,
      itemRows,
      runeRows,
      spellRows,
    });

    setPublicCache(res, { sMaxAge: 3600, swr: 21600 });
    return res.status(200).json(detail);
  } catch (error) {
    console.error("[wr-api] /api/guides/:slug error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
