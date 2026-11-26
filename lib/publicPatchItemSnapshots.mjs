import { applyPatchItemSnapshotCorrections } from "./patchItemSnapshotCorrections.mjs";
import { comparePatchVersions as comparePatchVersionNumbers, parsePatchVersion } from "./patchVersion.mjs";

function hasExpectedSnapshotScope(source) {
  return (!source?.snapshotScope || source.snapshotScope === "current-baseline")
    && (!source?.historicalReconstruction || source.historicalReconstruction === "not-performed");
}

function isExactCurrentPatchItemSnapshot(snapshot, patchVersion) {
  if (snapshot.patchVersion !== patchVersion || snapshot.sourcePatchVersion !== patchVersion) return false;
  if (snapshot.sourceKind !== "hub-game") return false;
  if (snapshot.state?.availability === "removed") return false;
  if (!hasExpectedSnapshotScope(snapshot.state)) return false;
  const catalogEvidence = Array.isArray(snapshot.sourceEvidence)
    ? snapshot.sourceEvidence.find((evidence) => evidence.role === "item-catalog")
    : null;
  return catalogEvidence?.sourcePatchVersion === patchVersion
    && hasExpectedSnapshotScope(catalogEvidence)
    && typeof catalogEvidence.sourceUpdatedAt === "string"
    && Boolean(catalogEvidence.sourceUpdatedAt);
}

function isExpectedCurrentItemSnapshot(snapshot) {
  return snapshot?.dataset === "items"
    && snapshot?.entityKind === "item"
    && snapshot?.sourceKind === "hub-game"
    && hasExpectedSnapshotScope(snapshot?.state)
    && typeof snapshot?.patchVersion === "string";
}

function isHubGameItemCatalogUrl(value) {
  let catalogUrl;
  try {
    catalogUrl = new URL(value);
  } catch {
    return false;
  }
  return catalogUrl.protocol === "https:"
    && catalogUrl.hostname === "hub-game.com"
    && catalogUrl.pathname.replace(/\/$/, "") === "/wildrift/en/items";
}

function hasCompleteCatalogCounts(evidence) {
  return Number.isInteger(evidence.listedItemCount)
    && evidence.listedItemCount > 0
    && (evidence.linkedDetailPageCount === undefined
      || (Number.isInteger(evidence.linkedDetailPageCount)
        && evidence.linkedDetailPageCount >= 0
        && evidence.linkedDetailPageCount <= evidence.listedItemCount));
}

function hasCurrentCatalogProvenance(snapshot, evidence) {
  return evidence.sourcePatchVersion === snapshot.patchVersion
    && typeof evidence.sourceUpdatedAt === "string"
    && Number.isFinite(Date.parse(evidence.sourceUpdatedAt))
    && (evidence.sourceBasis === undefined
      || (typeof evidence.sourceBasis === "string" && Boolean(evidence.sourceBasis.trim())));
}

function currentItemCatalogEvidence(snapshot) {
  if (!isExpectedCurrentItemSnapshot(snapshot)) return null;
  const evidenceRows = Array.isArray(snapshot.sourceEvidence)
    ? snapshot.sourceEvidence.filter((evidence) => evidence?.role === "item-catalog")
    : [];
  if (evidenceRows.length !== 1) return null;
  const evidence = evidenceRows[0];

  if (evidence.kind !== "hub-game"
    || !hasExpectedSnapshotScope(evidence)
    || !isHubGameItemCatalogUrl(evidence.url)
    || !hasCurrentCatalogProvenance(snapshot, evidence)
    || !hasCompleteCatalogCounts(evidence)) return null;

  return evidence;
}

function completeCurrentItemCatalogGroups(snapshots) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    const evidence = currentItemCatalogEvidence(snapshot);
    if (!evidence) continue;
    const key = JSON.stringify([
      snapshot.patchVersion,
      evidence.sourceUpdatedAt,
      evidence.url,
      evidence.listedItemCount,
      evidence.linkedDetailPageCount ?? null,
    ]);
    const group = groups.get(key) || { patchVersion: snapshot.patchVersion, evidence, snapshots: [] };
    group.snapshots.push(snapshot);
    groups.set(key, group);
  }

  return [...groups.values()].filter((group) => {
    const slugs = new Set(group.snapshots.map((snapshot) => snapshot.entitySlug));
    const sourceBases = new Set(group.snapshots
      .map((snapshot) => currentItemCatalogEvidence(snapshot)?.sourceBasis)
      .filter((sourceBasis) => typeof sourceBasis === "string" && sourceBasis.trim()));
    return group.snapshots.length === group.evidence.listedItemCount
      && slugs.size === group.evidence.listedItemCount
      && sourceBases.size <= 1;
  });
}

function comparePatchVersions(left, right) {
  const leftVersion = parsePatchVersion(left)?.value ?? "0.0";
  const rightVersion = parsePatchVersion(right)?.value ?? "0.0";
  return comparePatchVersionNumbers(leftVersion, rightVersion);
}

function normalizeEffect(effect) {
  const rawType = String(effect.type ?? "").toLowerCase();
  const marker = String(effect.name ?? "").match(/\((active|passive)\)\s*(?:\1)?\s*$/i)?.[1]?.toLowerCase();
  const type = marker || (rawType.includes("active") ? "active"
    : rawType.includes("passive") ? "passive"
      : "passive");
  const classification = ["source-label", "item-effects-section-default"].includes(effect.classification)
    ? effect.classification
    : rawType.includes("active") || rawType.includes("passive") || marker
      ? "source-label"
      : "item-effects-section-default";
  const name = String(effect.name ?? "").replace(/\s*\((active|passive)\)\s*(?:\1)?\s*$/i, "").trim();
  return { ...effect, name, type, classification };
}

function projectItemData(eligible, patchVersion, sourceOverride = null) {
  if (eligible.length === 0) return null;

  const first = eligible[0];
  const catalogEvidence = Array.isArray(first.sourceEvidence)
    ? first.sourceEvidence.find((evidence) => evidence?.role === "item-catalog")
    : null;
  const provenance = {
    kind: first.sourceKind,
    url: sourceOverride?.url || catalogEvidence?.url || first.sourceUrl,
    effectivePatchVersion: patchVersion,
    updatedAt: sourceOverride?.sourceUpdatedAt || catalogEvidence?.sourceUpdatedAt || first.sourceUpdatedAt,
    scope: "current-baseline",
    historicalReconstruction: "not-performed",
  };
  return {
    patchVersion,
    snapshotScope: "current-baseline",
    historicalReconstruction: "not-performed",
    source: provenance,
    items: eligible.map((snapshot) => {
      const state = snapshot.state || {};
      const rawEffects = Array.isArray(state.effects) && state.effects.length
        ? state.effects
        : [...(state.passives || []), ...(state.actives || [])];
      const effects = rawEffects.map(normalizeEffect);
      return {
        slug: snapshot.entitySlug,
        name: state.name,
        image: state.image ?? null,
        currentCost: state.cost ?? null,
        stats: Array.isArray(state.stats) ? state.stats : [],
        passives: effects.filter((effect) => effect.type === "passive"),
        actives: effects.filter((effect) => effect.type === "active"),
        effects,
        dataCoverage: state.dataCoverage ?? "unspecified",
        sourceHistory: {
          coverage: typeof state.sourceHistory?.coverage === "string"
            ? state.sourceHistory.coverage
            : "not-provided",
          entries: Array.isArray(state.sourceHistory?.entries) ? state.sourceHistory.entries : [],
        },
        verificationStatus: snapshot.verificationStatus,
        provenance: {
          kind: snapshot.sourceKind,
          url: snapshot.sourceUrl,
          sourcePatchVersion: snapshot.sourcePatchVersion,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          scope: "current-baseline",
          sourceEvidence: snapshot.sourceEvidence,
          ...(snapshot.latestCorrection ? { correction: snapshot.latestCorrection } : {}),
        },
      };
    }),
  };
}

/** Project only Hub's exact current item baseline for the requested patch. */
export function buildPublicPatchItemData(snapshots, patchVersion, corrections = []) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  if (typeof patchVersion !== "string" || !patchVersion.trim()) {
    throw new TypeError("patchVersion must be a non-empty string");
  }
  const correctedSnapshots = applyPatchItemSnapshotCorrections(snapshots, corrections);
  const eligible = correctedSnapshots.filter((snapshot) => isExactCurrentPatchItemSnapshot(snapshot, patchVersion));
  return projectItemData(eligible, patchVersion);
}

/** Project the freshest complete Hub catalog snapshot without labeling it historical for the requested patch. */
export function buildPublicCurrentItemBaseline(snapshots, corrections = []) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  const correctedSnapshots = applyPatchItemSnapshotCorrections(snapshots, corrections);
  const groups = completeCurrentItemCatalogGroups(correctedSnapshots).sort((left, right) =>
    Date.parse(right.evidence.sourceUpdatedAt) - Date.parse(left.evidence.sourceUpdatedAt)
      || comparePatchVersions(right.patchVersion, left.patchVersion));
  const selected = groups[0];
  if (!selected) return null;
  const tiedCandidates = groups.filter((group) =>
    Date.parse(group.evidence.sourceUpdatedAt) === Date.parse(selected.evidence.sourceUpdatedAt)
      && group.patchVersion === selected.patchVersion);
  if (tiedCandidates.length > 1) return null;

  const eligible = selected.snapshots.filter((snapshot) => snapshot.state?.availability !== "removed");
  const projected = projectItemData(eligible, selected.patchVersion, selected.evidence);
  if (!projected) return null;

  const detailPageItems = projected.items.filter((item) => item.dataCoverage === "detail-page").length;
  const catalogOnlyItems = projected.items.length - detailPageItems;
  const incompleteDataItems = projected.items.filter((item) => (
    item.dataCoverage !== "detail-page" || item.verificationStatus !== "verified"
  )).length;
  const explicitlyRemovedRows = selected.snapshots.filter((snapshot) => snapshot.state?.availability === "removed").length;

  return {
    ...projected,
    catalogCoverage: {
      listedItemCount: selected.evidence.listedItemCount,
      snapshotRowCount: selected.snapshots.length,
      includedItemCount: projected.items.length,
      detailPageItemCount: detailPageItems,
      catalogOnlyItemCount: catalogOnlyItems,
      incompleteDataItemCount: incompleteDataItems,
      explicitlyRemovedRowCount: explicitlyRemovedRows,
      completeForListedCatalog: true,
      completeItemDetails: incompleteDataItems === 0,
      verificationStatus: incompleteDataItems === 0 ? "verified" : "partial",
      // Legacy field means all catalog identities were represented, not that every
      // item's full stats and effects came from a detail page.
      complete: true,
    },
    verificationStatus: incompleteDataItems === 0 ? "verified" : "partial",
  };
}
