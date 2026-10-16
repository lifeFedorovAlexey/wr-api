import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { champions, guideEntities, guideSummaries, guideVariants, guideVariantSections, patchNotes, patchNoteChanges } from "../db/schema.js";
import { buildPublicIconPath } from "../lib/championIcons.mjs";
import { buildGuideAssetKey, buildPublicGuideAssetPath } from "../lib/guideAssets.mjs";
import { getPatchEffectiveDateMetadata } from "../lib/patchEffectiveDates.mjs";
import { RANKED_SEASONS } from "../lib/rankedSeasons.mjs";
import { buildTrendEvents, currentGuideRelations, validEventDate } from "../lib/trendEvents.mjs";
import { setCors } from "./utils/cors.js";

async function loadGuideRelations(slug, lane) {
  const [variants, sections, summaries] = await Promise.all([
    db.select().from(guideVariants).where(eq(guideVariants.guideSlug, slug)),
    db.select().from(guideVariantSections).where(eq(guideVariantSections.guideSlug, slug)),
    db.select().from(guideSummaries).where(eq(guideSummaries.slug, slug)),
  ]);
  return currentGuideRelations({ variants, sections, summary: summaries[0], lane });
}

async function loadPatches() {
  const rows = await db.select({
    patchVersion: patchNotes.patchVersion, locale: patchNotes.locale, sourceUrl: patchNotes.sourceUrl,
    // JSON extraction also works during rollout, before the date migration.
    // Unknown effective dates stay unknown; publishedAt is never substituted.
    effectiveDate: sql`to_jsonb(${patchNotes})->>'effective_date'`,
    effectiveRegion: sql`to_jsonb(${patchNotes})->>'effective_region'`,
    effectiveDateSourceUrl: sql`to_jsonb(${patchNotes})->>'effective_date_source_url'`,
  }).from(patchNotes).where(isNotNull(patchNotes.parsedPayload));
  return rows.map((row) => {
    const fallback = getPatchEffectiveDateMetadata(row.patchVersion);
    return row.effectiveDate ? row : { ...row, ...fallback };
  });
}

async function loadChanges(slug, relations, versions) {
  if (!versions.length) return [];
  const itemSlugs = [...relations.keys()].filter((key) => key.startsWith("item:")).map((key) => key.slice(5));
  const runeSlugs = [...relations.keys()].filter((key) => key.startsWith("rune:")).map((key) => key.slice(5));
  const entityFilters = [and(eq(patchNoteChanges.entityKind, "champion"), eq(patchNoteChanges.entitySlug, slug))];
  if (itemSlugs.length) entityFilters.push(and(eq(patchNoteChanges.entityKind, "item"), inArray(patchNoteChanges.entitySlug, itemSlugs)));
  if (runeSlugs.length) entityFilters.push(and(eq(patchNoteChanges.entityKind, "rune"), inArray(patchNoteChanges.entitySlug, runeSlugs)));
  const [rows, championRows, entities] = await Promise.all([
    db.select().from(patchNoteChanges).where(and(inArray(patchNoteChanges.patchVersion, versions), or(...entityFilters)))
      .orderBy(patchNoteChanges.ordinal),
    db.select({ icon: champions.icon }).from(champions).where(eq(champions.slug, slug)).limit(1),
    itemSlugs.length || runeSlugs.length
      ? db.select().from(guideEntities).where(inArray(guideEntities.slug, [...itemSlugs, ...runeSlugs])) : [],
  ]);
  const catalog = new Map(entities.map((row) => [`${row.kind}:${row.slug}`, row]));
  return rows.map((row) => {
    if (row.entityKind === "champion" && championRows[0]?.icon) {
      return { ...row, imageUrl: buildPublicIconPath(slug, championRows[0].icon) };
    }
    const entity = catalog.get(`${row.entityKind}:${row.entitySlug}`);
    const image = entity?.tooltipImageUrl || entity?.imageUrl;
    return image ? { ...row, imageUrl: buildPublicGuideAssetPath(buildGuideAssetKey("guide", row.entityKind, row.entitySlug, "image"), image) } : row;
  });
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });
  const { slug, lane, from, to } = req.query;
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/.test(slug)
    || !["top", "jungle", "mid", "adc", "support"].includes(lane)
    || !validEventDate(from) || !validEventDate(to) || from > to) {
    return res.status(400).json({ error: "Bad Request" });
  }
  try {
    const [patches, relations] = await Promise.all([loadPatches(), loadGuideRelations(slug, lane)]);
    const versions = [...new Set(patches.filter((row) => row.effectiveRegion === "CN"
      && validEventDate(row.effectiveDate) && row.effectiveDate >= from && row.effectiveDate <= to)
      .map((row) => row.patchVersion))];
    const changes = await loadChanges(slug, relations, versions);
    const result = buildTrendEvents({ patches, changes, slug, relations, from, to, seasons: RANKED_SEASONS });
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    return res.status(200).json(result);
  } catch (error) {
    console.error("[wr-api] /api/trend-events error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
