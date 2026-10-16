import { createHash } from "node:crypto";

export const CHAMPION_BASE_STATS_DATASET = "champion-base-stats";
export const HUB_GAME_CHAMPION_STATS_SOURCE = "hub-game-champion-stats-baseline";

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stateHash(state) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

/** Convert Hub's current champion table into rows at its explicitly stated global patch. */
export function buildPatchChampionStatSnapshotRows(parsed) {
  if (!parsed || parsed.baselineKind !== "current-global-champion-stats") {
    throw new TypeError("A current Hub global champion stats baseline is required");
  }
  const patchVersion = requiredText(parsed.globalPatchThrough, "globalPatchThrough");
  const sourceKind = requiredText(parsed.sourceKind, "sourceKind");
  const sourceUrl = requiredText(parsed.sourceUrl, "sourceUrl");
  const sourcePatchVersion = requiredText(parsed.chinaLibraryPatch, "chinaLibraryPatch");
  const sourceUpdatedAt = requiredText(parsed.chinaLibraryAsOf, "chinaLibraryAsOf");
  const sourceEvidence = [{
    kind: sourceKind,
    url: sourceUrl,
    sourcePatchVersion,
    sourceUpdatedAt,
    globalPatchThrough: patchVersion,
  }];

  if (!Array.isArray(parsed.champions) || parsed.champions.length !== parsed.count || parsed.count < 1) {
    throw new Error("Hub champion baseline has an invalid champion roster");
  }

  const slugs = new Set();
  return parsed.champions.map((champion) => {
    const entitySlug = requiredText(champion.slug, "champion.slug");
    if (slugs.has(entitySlug)) throw new Error(`Duplicate champion slug in Hub baseline: ${entitySlug}`);
    slugs.add(entitySlug);
    const name = requiredText(champion.name, `champion ${entitySlug} name`);
    const hubSlug = requiredText(champion.hubSlug, `champion ${entitySlug} Hub slug`);
    if (!champion.statsAtLevel1 || typeof champion.statsAtLevel1 !== "object" || !champion.ratings || typeof champion.ratings !== "object") {
      throw new Error(`Champion ${entitySlug} is missing level-1 stats or ratings`);
    }

    const state = {
      name,
      hubSlug,
      statsAtLevel1: champion.statsAtLevel1,
      ratings: champion.ratings,
      source: {
        sourceKind,
        sourceUrl,
        patchVersion,
        sourcePatchVersion,
        sourceUpdatedAt,
      },
    };
    return {
      patchVersion,
      dataset: CHAMPION_BASE_STATS_DATASET,
      entityKind: "champion",
      entitySlug,
      state,
      sourceKind,
      sourceUrl,
      sourcePatchVersion,
      sourceUpdatedAt,
      verificationStatus: "verified",
      sourceEvidence,
      contentHash: stateHash(state),
    };
  });
}

/** Refuse to mutate or partially extend a patch's already-persisted roster. */
export function assertImmutablePatchSnapshot(existingRows, incomingRows) {
  if (!Array.isArray(existingRows) || !Array.isArray(incomingRows) || incomingRows.length === 0) {
    throw new TypeError("Existing rows must be an array and incoming snapshot rows must be non-empty");
  }
  if (existingRows.length === 0) return { unchanged: 0 };

  const incomingBySlug = new Map(incomingRows.map((row) => [row.entitySlug, row.contentHash]));
  const existingBySlug = new Map(existingRows.map((row) => [row.entity_slug, row.content_hash]));
  const missingFromIncoming = [...existingBySlug.keys()].filter((slug) => !incomingBySlug.has(slug));
  const newInIncoming = [...incomingBySlug.keys()].filter((slug) => !existingBySlug.has(slug));
  const changed = [...existingBySlug]
    .filter(([slug, hash]) => incomingBySlug.has(slug) && incomingBySlug.get(slug) !== hash)
    .map(([slug]) => slug);
  if (missingFromIncoming.length || newInIncoming.length || changed.length) {
    const details = [
      missingFromIncoming.length && `missing from source: ${missingFromIncoming.join(", ")}`,
      newInIncoming.length && `new source rows: ${newInIncoming.join(", ")}`,
      changed.length && `changed values: ${changed.join(", ")}`,
    ].filter(Boolean).join("; ");
    throw new Error(`Refusing to mutate immutable champion snapshot: ${details}`);
  }
  return { unchanged: existingRows.length };
}

/** Project stored rows without implying that a source baseline is reconstructed history. */
export function buildPublicChampionStats(snapshots, championRows, patchVersion) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  const namesBySlug = new Map((championRows || []).map((champion) => [champion.slug, champion.name]));
  const getSnapshotScope = (snapshot) => snapshot.state?.snapshotScope
    || (snapshot.sourceKind === HUB_GAME_CHAMPION_STATS_SOURCE ? "current-baseline" : "unclassified");
  const getReconstructionStatus = (snapshot) => snapshot.state?.historicalReconstruction
    || (getSnapshotScope(snapshot) === "current-baseline" ? "not-performed" : "unclassified");
  const snapshotScopes = new Set(snapshots.map(getSnapshotScope));
  const reconstructionStatuses = new Set(snapshots.map(getReconstructionStatus));
  const firstSnapshot = snapshots[0];
  const firstStateSource = firstSnapshot.state?.source || {};
  return {
    patchVersion,
    snapshotScope: snapshotScopes.size === 1 ? [...snapshotScopes][0] : "mixed",
    historicalReconstruction: reconstructionStatuses.size === 1 ? [...reconstructionStatuses][0] : "mixed",
    source: {
      kind: firstSnapshot.sourceKind,
      url: firstSnapshot.sourceUrl,
      sourcePatchVersion: firstSnapshot.sourcePatchVersion,
      sourceUpdatedAt: firstSnapshot.sourceUpdatedAt,
      declaredBase: firstSnapshot.sourceKind === HUB_GAME_CHAMPION_STATS_SOURCE && firstStateSource.sourcePatchVersion
        ? "Tencent China champion library"
        : "unclassified",
      chinaLibraryPatch: firstStateSource.sourcePatchVersion || null,
      chinaLibraryAsOf: firstStateSource.sourceUpdatedAt || null,
      globalPatchThrough: firstStateSource.patchVersion || null,
    },
    verificationStatus: snapshots.every((snapshot) => snapshot.verificationStatus === "verified")
      ? "verified"
      : "partial",
    champions: snapshots.map((snapshot) => ({
      slug: snapshot.entitySlug,
      name: namesBySlug.get(snapshot.entitySlug) || snapshot.state.name,
      statsAtLevel1: snapshot.state.statsAtLevel1,
      snapshotScope: getSnapshotScope(snapshot),
      historicalReconstruction: getReconstructionStatus(snapshot),
      verificationStatus: snapshot.verificationStatus,
    })),
  };
}
