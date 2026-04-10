import { eq, sql } from "drizzle-orm";

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
import { buildGuideImportRecord, shouldSkipGuideImport } from "./guides.mjs";

const GUIDE_IMPORT_ADVISORY_LOCK_KEY = 7_101_001;

function buildGuideSummaryValues(summary, now) {
  return {
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
    updatedAt: now,
  };
}

function buildGuideEntityValues(entity, now) {
  return {
    kind: entity.kind,
    slug: entity.slug,
    name: entity.name,
    imageUrl: entity.imageUrl,
    lane: entity.lane,
    entityId: entity.entityId,
    entityKind: entity.entityKind,
    videoUrl: entity.videoUrl,
    tooltipTitle: entity.tooltipTitle,
    tooltipCost: entity.tooltipCost,
    tooltipImageUrl: entity.tooltipImageUrl,
    tooltipStats: entity.tooltipStats,
    tooltipLines: entity.tooltipLines,
    updatedAt: now,
  };
}

async function fetchExistingGuideSummary(slug) {
  const [existingSummary] = await db
    .select({
      contentHash: guideSummaries.contentHash,
      updatedAt: guideSummaries.updatedAt,
    })
    .from(guideSummaries)
    .where(eq(guideSummaries.slug, slug));

  return existingSummary;
}

async function upsertGuideSummary(tx, summary, now) {
  const values = buildGuideSummaryValues(summary, now);

  await tx
    .insert(guideSummaries)
    .values(values)
    .onConflictDoUpdate({
      target: guideSummaries.slug,
      set: values,
    });
}

async function upsertGuideEntities(tx, entities, now) {
  for (const entity of entities) {
    const values = buildGuideEntityValues(entity, now);

    await tx
      .insert(guideEntities)
      .values(values)
      .onConflictDoUpdate({
        target: [guideEntities.kind, guideEntities.slug],
        set: values,
      });
  }
}

async function deleteGuideRelations(tx, guideSlug) {
  const relationDeletes = [
    [guideOfficialMeta, guideOfficialMeta.guideSlug],
    [guideAbilities, guideAbilities.guideSlug],
    [guideBuildBreakdowns, guideBuildBreakdowns.guideSlug],
    [guideVariants, guideVariants.guideSlug],
    [guideVariantSections, guideVariantSections.guideSlug],
    [guideVariantSkillOrders, guideVariantSkillOrders.guideSlug],
    [guideVariantSkillRows, guideVariantSkillRows.guideSlug],
    [guideVariantMatchups, guideVariantMatchups.guideSlug],
  ];

  for (const [table, column] of relationDeletes) {
    await tx.delete(table).where(eq(column, guideSlug));
  }
}

async function insertGuideRelations(tx, record) {
  await tx.insert(guideOfficialMeta).values(record.officialMeta);

  if (record.abilities.length) {
    await tx.insert(guideAbilities).values(record.abilities);
  }

  if (record.buildBreakdown) {
    await tx.insert(guideBuildBreakdowns).values(record.buildBreakdown);
  }

  if (record.variants.length) {
    await tx.insert(guideVariants).values(record.variants);
  }

  if (record.sections.length) {
    await tx.insert(guideVariantSections).values(record.sections);
  }

  if (record.skillOrders.length) {
    await tx.insert(guideVariantSkillOrders).values(record.skillOrders);
  }

  if (record.skillRows.length) {
    await tx.insert(guideVariantSkillRows).values(record.skillRows);
  }

  if (record.matchups.length) {
    await tx.insert(guideVariantMatchups).values(record.matchups);
  }
}

export async function importGuidePayload(guide, options = {}) {
  if (!guide?.champion?.slug || !guide?.champion?.name) {
    throw new Error("Invalid guide payload");
  }

  const record = buildGuideImportRecord(guide);
  const now = options.now instanceof Date ? options.now : new Date();
  const existingSummary = await fetchExistingGuideSummary(record.summary.slug);

  if (shouldSkipGuideImport(existingSummary, record.summary)) {
    return {
      ok: true,
      slug: record.summary.slug,
      skipped: true,
      reason: "same-content-hash",
      updatedAt:
        existingSummary?.updatedAt instanceof Date ? existingSummary.updatedAt.toISOString() : null,
    };
  }

  await db.transaction(async (tx) => {
    // guide_entities are shared across every guide import, so concurrent guide-sync
    // workers must serialize the transaction that mutates them.
    await tx.execute(sql`select pg_advisory_xact_lock(${GUIDE_IMPORT_ADVISORY_LOCK_KEY})`);

    await upsertGuideSummary(tx, record.summary, now);
    await upsertGuideEntities(tx, record.entities, now);
    await deleteGuideRelations(tx, record.summary.slug);
    await insertGuideRelations(tx, record);
  });

  return {
    ok: true,
    slug: record.summary.slug,
    skipped: false,
    updatedAt: now.toISOString(),
  };
}
