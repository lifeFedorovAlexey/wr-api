import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "../db/client.js";
import {
  champions,
  guideEntities,
  patchDataSnapshotCorrections,
  patchDataSnapshots,
  patchNoteChanges,
  patchNotes,
} from "../db/schema.js";
import { buildPublicIconPath } from "../lib/championIcons.mjs";
import { buildGuideAssetKey, buildPublicGuideAssetPath } from "../lib/guideAssets.mjs";
import {
  buildPatchSkinAssetKey,
  resolvePatchSkinImageFallback,
} from "../lib/patchSkinImages.mjs";
import { buildPublicChampionStats } from "../lib/patchChampionStatSnapshots.mjs";
import { buildPublicPatchItemDataForDetail } from "../lib/publicPatchItemDataForDetail.mjs";
import { buildPublicPatchReferenceData } from "../lib/publicPatchReferenceData.mjs";
import { buildPublicPatchDetailResponse } from "../lib/publicPatchDetailResponse.mjs";
import { countPatchChampionChanges } from "../lib/patchChampionChangeCounts.mjs";
import { countPatchChangeEntities } from "../lib/patchNoteEntityCounts.mjs";
import { comparePatchVersions } from "../lib/patchVersion.mjs";
import {
  resolvePatchChangeDisplayNameWithStatus,
} from "../lib/patchNotePreviewNames.mjs";
import { localizePatchNoteDisplayLabels } from "../lib/patchNoteDisplayLabels.mjs";
import { normalizePatchChangeEntityClassification } from "../lib/patchNoteEntityClassification.mjs";
import { setCors } from "./utils/cors.js";

function setPublicCache(res) {
  res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=7200");
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function isMissingRelationError(error) {
  for (let current = error; current; current = current.cause) {
    if (current.code === "42P01") return true;
  }
  return false;
}

function isMissingColumnError(error) {
  for (let current = error; current; current = current.cause) {
    if (current.code === "42703") return true;
  }
  return false;
}

const PATCH_DATA_CORRECTION_FIELDS = {
  id: patchDataSnapshotCorrections.id,
  patchVersion: patchDataSnapshotCorrections.patchVersion,
  dataset: patchDataSnapshotCorrections.dataset,
  entityKind: patchDataSnapshotCorrections.entityKind,
  entitySlug: patchDataSnapshotCorrections.entitySlug,
  previousContentHash: patchDataSnapshotCorrections.previousContentHash,
  correctedContentHash: patchDataSnapshotCorrections.correctedContentHash,
  correctedState: patchDataSnapshotCorrections.correctedState,
  sourceKind: patchDataSnapshotCorrections.sourceKind,
  sourceUrl: patchDataSnapshotCorrections.sourceUrl,
  sourcePatchVersion: patchDataSnapshotCorrections.sourcePatchVersion,
  sourceUpdatedAt: patchDataSnapshotCorrections.sourceUpdatedAt,
  verificationStatus: patchDataSnapshotCorrections.verificationStatus,
  sourceEvidence: patchDataSnapshotCorrections.sourceEvidence,
  reason: patchDataSnapshotCorrections.reason,
  createdAt: patchDataSnapshotCorrections.createdAt,
};

async function loadPatchDataCorrectionRows(where) {
  const selectRows = (includeCorrectedSlug) => db
    .select(includeCorrectedSlug
      ? { ...PATCH_DATA_CORRECTION_FIELDS, correctedEntitySlug: patchDataSnapshotCorrections.correctedEntitySlug }
      : PATCH_DATA_CORRECTION_FIELDS)
    .from(patchDataSnapshotCorrections)
    .where(where)
    .orderBy(asc(patchDataSnapshotCorrections.id));

  try {
    return await selectRows(true);
  } catch (error) {
    if (isMissingRelationError(error)) return [];
    if (!isMissingColumnError(error)) throw error;

    // Keep reads working until the additive corrected_entity_slug migration is applied.
    // Legacy correction rows did not contain a canonical-slug replacement.
    return (await selectRows(false)).map((row) => ({ ...row, correctedEntitySlug: null }));
  }
}

const PUBLIC_FIELDS = {
  patchVersion: patchNotes.patchVersion,
  locale: patchNotes.locale,
  title: patchNotes.title,
  description: patchNotes.description,
  sourceUrl: patchNotes.sourceUrl,
  publishedAt: patchNotes.publishedAt,
  effectiveDate: patchNotes.effectiveDate,
  effectiveRegion: patchNotes.effectiveRegion,
  effectiveDateSourceUrl: patchNotes.effectiveDateSourceUrl,
  imageUrl: patchNotes.imageUrl,
  parsedPayload: patchNotes.parsedPayload,
};

function sourceFromStoredImage(imageUrl) {
  const query = String(imageUrl || "").split("?", 2)[1] || "";
  return new URLSearchParams(query).get("src");
}

function storedGuideAssetKey(imageUrl) {
  try {
    const url = new URL(String(imageUrl || ""), "https://wildriftallstats.ru");
    const match = url.pathname.match(/(?:^|\/)wr-api\/(?:api\/)?assets\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

async function loadImageCatalog() {
  const [championRows, guideRows] = await Promise.all([
    db.select({
      slug: champions.slug,
      icon: champions.icon,
      name: champions.name,
      nameLocalizations: champions.nameLocalizations,
    }).from(champions),
    db.select({
      kind: guideEntities.kind,
      slug: guideEntities.slug,
      name: guideEntities.name,
      imageUrl: guideEntities.imageUrl,
      tooltipImageUrl: guideEntities.tooltipImageUrl,
    }).from(guideEntities).where(inArray(guideEntities.kind, ["item", "rune", "summonerSpell"])),
  ]);

  return {
    champions: new Map(championRows.map((row) => [row.slug, row])),
    guideEntities: new Map(guideRows.map((row) => [`${row.kind}:${row.slug}`, row])),
  };
}

export function resolveChangeImageUrl(row, catalog, env = process.env) {
  const storedSource = sourceFromStoredImage(row.imageUrl);
  if (row.entityKind === "champion" && row.entitySlug) {
    const sourceUrl = catalog.champions.get(row.entitySlug)?.icon || storedSource;
    if (sourceUrl) return buildPublicIconPath(row.entitySlug, sourceUrl);
  }

  if (["item", "rune", "spell"].includes(row.entityKind) && row.entitySlug) {
    const kind = row.entityKind === "spell" ? "summonerSpell" : row.entityKind;
    const item = catalog.guideEntities.get(`${kind}:${row.entitySlug}`);
    const sourceUrl = item?.tooltipImageUrl || item?.imageUrl || storedSource;
    if (sourceUrl) {
      const assetKey = buildGuideAssetKey("guide", kind, row.entitySlug, "image");
      return buildPublicGuideAssetPath(assetKey, sourceUrl);
    }
  }

  if (row.entityKind === "skin" && row.entitySlug) {
    const sourceUrl = storedSource || directRiotSkinSource(row.imageUrl);
    if (sourceUrl) {
      const assetKey = storedGuideAssetKey(row.imageUrl) || buildPatchSkinAssetKey(row.entitySlug, sourceUrl);
      return buildPublicGuideAssetPath(assetKey, sourceUrl);
    }
    if (row.imageUrl) return row.imageUrl;

    const fallback = resolvePatchSkinImageFallback(row);
    if (fallback?.imageUrl) {
      const assetKey = buildPatchSkinAssetKey(fallback.assetSlug || row.entitySlug, fallback.imageUrl);
      return buildPublicGuideAssetPath(assetKey, fallback.imageUrl, env);
    }
    return null;
  }

  // Older imports persisted proxy URLs. Resolve them through the same S3 asset
  // key used by the importer instead of exposing the obsolete proxy route.
  const assetKey = storedGuideAssetKey(row.imageUrl);
  if (assetKey && storedSource) return buildPublicGuideAssetPath(assetKey, storedSource);
  return row.imageUrl;
}

function directRiotSkinSource(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "cmsassets.rgpub.io" ? url.toString() : null;
  } catch {
    return null;
  }
}

function toPublicChange(row, catalog, locale) {
  const classifiedRow = normalizePatchChangeEntityClassification(row);
  const displayRow = localizePatchNoteDisplayLabels(classifiedRow, locale);
  const nameResolution = resolvePatchChangeDisplayNameWithStatus(displayRow, catalog);
  return {
    ...displayRow,
    displayNameRu: nameResolution.displayNameRu,
    nameStatus: nameResolution.nameStatus,
    imageUrl: resolveChangeImageUrl(classifiedRow, catalog),
  };
}

function loadPatchChangeRows(version, locale) {
  return db
    .select({
      ordinal: patchNoteChanges.ordinal,
      entityKind: patchNoteChanges.entityKind,
      entitySlug: patchNoteChanges.entitySlug,
      entityName: patchNoteChanges.entityName,
      imageUrl: patchNoteChanges.imageUrl,
      changeType: patchNoteChanges.changeType,
      sectionName: patchNoteChanges.sectionName,
      changeName: patchNoteChanges.changeName,
      scope: patchNoteChanges.scope,
      details: patchNoteChanges.details,
    })
    .from(patchNoteChanges)
    .where(and(
      eq(patchNoteChanges.patchVersion, version),
      eq(patchNoteChanges.locale, locale),
    ))
    .orderBy(patchNoteChanges.ordinal);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const version = String(req.params?.version || "").trim().toLowerCase();
    if (version) {
      const localeQuery = req.query?.locale;
      if (localeQuery !== undefined && typeof localeQuery !== "string") {
        setNoStore(res);
        return res.status(400).json({ error: "Unsupported locale" });
      }
      const requestedLocale = localeQuery?.trim().toLowerCase() || "ru-ru";
      if (!["ru-ru", "en-us"].includes(requestedLocale)) {
        setNoStore(res);
        return res.status(400).json({ error: "Unsupported locale" });
      }
      const rows = await db
        .select(PUBLIC_FIELDS)
        .from(patchNotes)
        .where(eq(patchNotes.patchVersion, version));
      const selected = rows.find((row) => row.locale === requestedLocale && row.parsedPayload)
        || (localeQuery === undefined && requestedLocale === "ru-ru"
          ? rows.find((row) => row.locale === "en-us" && row.parsedPayload)
          : null);
      if (!selected) {
        setNoStore(res);
        return res.status(404).json({ error: "Not Found" });
      }
      const englishChangesPromise = selected.locale === "en-us"
        ? null
        : loadPatchChangeRows(version, "en-us");
      const [imageCatalog, changes, englishChangeRows, statSnapshots, statCorrections, itemSnapshots, itemCorrections, referenceSnapshots, referenceCorrections, championRows] = await Promise.all([
        loadImageCatalog(),
        loadPatchChangeRows(version, selected.locale),
        englishChangesPromise,
        db.select({
          patchVersion: patchDataSnapshots.patchVersion,
          dataset: patchDataSnapshots.dataset,
          entityKind: patchDataSnapshots.entityKind,
          entitySlug: patchDataSnapshots.entitySlug,
          state: patchDataSnapshots.state,
          verificationStatus: patchDataSnapshots.verificationStatus,
          sourceKind: patchDataSnapshots.sourceKind,
          sourceUrl: patchDataSnapshots.sourceUrl,
          sourcePatchVersion: patchDataSnapshots.sourcePatchVersion,
          sourceUpdatedAt: patchDataSnapshots.sourceUpdatedAt,
          sourceEvidence: patchDataSnapshots.sourceEvidence,
          contentHash: patchDataSnapshots.contentHash,
        })
          .from(patchDataSnapshots)
          .where(eq(patchDataSnapshots.dataset, "champion-base-stats"))
          .orderBy(asc(patchDataSnapshots.patchVersion), asc(patchDataSnapshots.entitySlug)),
        loadPatchDataCorrectionRows(eq(patchDataSnapshotCorrections.dataset, "champion-base-stats")),
        db.select({
          patchVersion: patchDataSnapshots.patchVersion,
          dataset: patchDataSnapshots.dataset,
          entityKind: patchDataSnapshots.entityKind,
          entitySlug: patchDataSnapshots.entitySlug,
          state: patchDataSnapshots.state,
          verificationStatus: patchDataSnapshots.verificationStatus,
          sourceKind: patchDataSnapshots.sourceKind,
          sourceUrl: patchDataSnapshots.sourceUrl,
          sourcePatchVersion: patchDataSnapshots.sourcePatchVersion,
          sourceUpdatedAt: patchDataSnapshots.sourceUpdatedAt,
          sourceEvidence: patchDataSnapshots.sourceEvidence,
          contentHash: patchDataSnapshots.contentHash,
        })
          .from(patchDataSnapshots)
          .where(and(
            eq(patchDataSnapshots.dataset, "items"),
          ))
          .orderBy(asc(patchDataSnapshots.patchVersion), asc(patchDataSnapshots.entitySlug)),
        loadPatchDataCorrectionRows(and(
            eq(patchDataSnapshotCorrections.dataset, "items"),
          )),
        db.select({
          patchVersion: patchDataSnapshots.patchVersion,
          dataset: patchDataSnapshots.dataset,
          entityKind: patchDataSnapshots.entityKind,
          entitySlug: patchDataSnapshots.entitySlug,
          state: patchDataSnapshots.state,
          contentHash: patchDataSnapshots.contentHash,
          verificationStatus: patchDataSnapshots.verificationStatus,
          sourceKind: patchDataSnapshots.sourceKind,
          sourceUrl: patchDataSnapshots.sourceUrl,
          sourcePatchVersion: patchDataSnapshots.sourcePatchVersion,
          sourceUpdatedAt: patchDataSnapshots.sourceUpdatedAt,
          sourceEvidence: patchDataSnapshots.sourceEvidence,
        })
          .from(patchDataSnapshots)
          .where(inArray(patchDataSnapshots.dataset, ["runes", "summoner-spells"])),
        loadPatchDataCorrectionRows(inArray(patchDataSnapshotCorrections.dataset, ["runes", "summoner-spells"])),
        db.select({
          slug: champions.slug,
          name: champions.name,
          nameLocalizations: champions.nameLocalizations,
        }).from(champions),
      ]);
      const championStats = buildPublicChampionStats(statSnapshots, championRows, version, selected.locale, statCorrections);
      const patchItemData = buildPublicPatchItemDataForDetail({
        patchVersion: version,
        snapshots: itemSnapshots,
        corrections: itemCorrections,
        changes: changes.map((row) => toPublicChange(row, imageCatalog, selected.locale)),
        englishChanges: (englishChangeRows || changes).map(normalizePatchChangeEntityClassification),
      });
      const runeData = buildPublicPatchReferenceData(referenceSnapshots, "runes", referenceCorrections, version);
      const summonerSpellData = buildPublicPatchReferenceData(referenceSnapshots, "summoner-spells", referenceCorrections, version);
      setPublicCache(res);
      return res.status(200).json(buildPublicPatchDetailResponse({
        patch: selected,
        changes: patchItemData.changes,
        championStats,
        itemData: patchItemData.itemData,
        currentItemBaseline: patchItemData.currentItemBaseline,
        runeData,
        summonerSpellData,
      }));
    }

    const rows = await db
      .select(PUBLIC_FIELDS)
      .from(patchNotes)
      .where(isNotNull(patchNotes.parsedPayload))
      .orderBy(desc(patchNotes.publishedAt));
    const byVersion = new Map();
    for (const row of rows) {
      if (!row.parsedPayload) continue;
      const current = byVersion.get(row.patchVersion) || {};
      current[row.locale] = row;
      byVersion.set(row.patchVersion, current);
    }
    const storedPreviewRows = await db
      .select({
        patchVersion: patchNoteChanges.patchVersion,
        locale: patchNoteChanges.locale,
        entityKind: patchNoteChanges.entityKind,
        entitySlug: patchNoteChanges.entitySlug,
        entityName: patchNoteChanges.entityName,
        sectionName: patchNoteChanges.sectionName,
        changeName: patchNoteChanges.changeName,
        imageUrl: patchNoteChanges.imageUrl,
        changeType: patchNoteChanges.changeType,
        scope: patchNoteChanges.scope,
      })
      .from(patchNoteChanges)
      .orderBy(patchNoteChanges.ordinal);
    const previewRows = storedPreviewRows.map(normalizePatchChangeEntityClassification);
    const imageCatalog = await loadImageCatalog();
    const previewsByPatch = new Map();
    const championChangeCountsByPatch = countPatchChampionChanges(previewRows);
    const changeCountsByPatch = countPatchChangeEntities(previewRows);
    for (const row of previewRows) {
      if (row.scope?.type === "game-mode") continue;
      if (!["champion", "item", "rune", "spell"].includes(row.entityKind)) continue;
      const imageUrl = resolveChangeImageUrl(row, imageCatalog);
      const key = `${row.patchVersion}:${row.locale}`;
      const previews = previewsByPatch.get(key) || {
        new: [], buff: [], adjustment: [], rework: [], nerf: [], removed: [], seen: new Set(),
      };
      const identity = `${row.entityKind}:${row.entitySlug || row.entityName}`;
      const tone = ["new", "buff", "adjustment", "rework", "nerf", "removed"].includes(row.changeType)
        ? row.changeType
        : "adjustment";
      const previewKey = `${tone}:${identity}`;
      if (!previews.seen.has(previewKey)) {
        previews.seen.add(previewKey);
        const nameResolution = resolvePatchChangeDisplayNameWithStatus(row, imageCatalog);
        previews[tone].push({
          entityKind: row.entityKind,
          entitySlug: row.entitySlug,
          entityName: nameResolution.displayNameRu,
          nameStatus: nameResolution.nameStatus,
          imageUrl,
        });
      }
      previewsByPatch.set(key, previews);
    }
    const items = Array.from(byVersion.entries())
      .map(([patchVersion, locales]) => {
        const selected = locales["ru-ru"] || locales["en-us"];
        return {
          version: patchVersion,
          locale: selected.locale,
          title: selected.title,
          description: selected.description,
          sourceUrl: selected.sourceUrl,
          publishedAt: selected.publishedAt,
          effectiveDate: selected.effectiveDate,
          effectiveRegion: selected.effectiveRegion,
          effectiveDateSourceUrl: selected.effectiveDateSourceUrl,
          imageUrl: selected.imageUrl,
          availableLocales: Object.keys(locales),
          championChangeCounts: championChangeCountsByPatch.get(`${patchVersion}:${selected.locale}`)
            || { buff: 0, nerf: 0, adjustment: 0 },
          changeCountsByKind: changeCountsByPatch.get(`${patchVersion}:${selected.locale}`)
            || { champions: 0, items: 0, runes: 0, spells: 0, skins: 0, system: 0, total: 0 },
          iconPreviews: (() => {
            const previews = previewsByPatch.get(`${patchVersion}:${selected.locale}`);
            if (!previews) return { new: [], buff: [], adjustment: [], rework: [], nerf: [], removed: [] };
            return {
              new: previews.new,
              buff: previews.buff,
              adjustment: previews.adjustment,
              rework: previews.rework,
              nerf: previews.nerf,
              removed: previews.removed,
            };
          })(),
        };
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
        return dateDiff || -comparePatchVersions(a.version, b.version);
      });
    setPublicCache(res);
    return res.status(200).json({ count: items.length, items });
  } catch (error) {
    console.error("[wr-api] /api/patch-notes error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
