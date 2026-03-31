import { eq } from "drizzle-orm";

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
import { buildGuideImportRecord } from "../lib/guides.mjs";
import { ensureAuthorized } from "./utils/adminAuth.js";
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

  if (
    !ensureAuthorized(req, res, {
      tokenEnvNames: ["GUIDES_SYNC_TOKEN"],
      secretHeader: "x-guides-sync-secret",
      secretEnvNames: ["GUIDES_SYNC_SECRET"],
    })
  ) {
    return;
  }

  const guide = req.body?.guide;

  if (!guide?.champion?.slug || !guide?.champion?.name) {
    setNoStore(res);
    return res.status(400).json({ error: "Invalid guide payload" });
  }

  try {
    const record = buildGuideImportRecord(guide);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx
        .insert(guideSummaries)
        .values({
          slug: record.summary.slug,
          name: record.summary.name,
          title: record.summary.title,
          icon: record.summary.icon,
          patch: record.summary.patch,
          tier: record.summary.tier,
          recommendedRole: record.summary.recommendedRole,
          roles: record.summary.roles,
          buildCount: record.summary.buildCount,
          sourceSite: record.summary.sourceSite,
          sourceUrl: record.summary.sourceUrl,
          contentHash: record.summary.contentHash,
          fetchedAt: record.summary.fetchedAt ? new Date(record.summary.fetchedAt) : now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: guideSummaries.slug,
          set: {
            name: record.summary.name,
            title: record.summary.title,
            icon: record.summary.icon,
            patch: record.summary.patch,
            tier: record.summary.tier,
            recommendedRole: record.summary.recommendedRole,
            roles: record.summary.roles,
            buildCount: record.summary.buildCount,
            sourceSite: record.summary.sourceSite,
            sourceUrl: record.summary.sourceUrl,
            contentHash: record.summary.contentHash,
            fetchedAt: record.summary.fetchedAt ? new Date(record.summary.fetchedAt) : now,
            updatedAt: now,
          },
        });

      for (const entity of record.entities) {
        await tx
          .insert(guideEntities)
          .values({
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
          })
          .onConflictDoUpdate({
            target: [guideEntities.kind, guideEntities.slug],
            set: {
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
            },
          });
      }

      await tx.delete(guideOfficialMeta).where(eq(guideOfficialMeta.guideSlug, record.summary.slug));
      await tx.delete(guideAbilities).where(eq(guideAbilities.guideSlug, record.summary.slug));
      await tx
        .delete(guideBuildBreakdowns)
        .where(eq(guideBuildBreakdowns.guideSlug, record.summary.slug));
      await tx.delete(guideVariants).where(eq(guideVariants.guideSlug, record.summary.slug));
      await tx
        .delete(guideVariantSections)
        .where(eq(guideVariantSections.guideSlug, record.summary.slug));
      await tx
        .delete(guideVariantSkillOrders)
        .where(eq(guideVariantSkillOrders.guideSlug, record.summary.slug));
      await tx
        .delete(guideVariantSkillRows)
        .where(eq(guideVariantSkillRows.guideSlug, record.summary.slug));
      await tx
        .delete(guideVariantMatchups)
        .where(eq(guideVariantMatchups.guideSlug, record.summary.slug));

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
    });

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      slug: record.summary.slug,
      updatedAt: now.toISOString(),
    });
  } catch (error) {
    console.error("[wr-api] /api/guides/import error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
