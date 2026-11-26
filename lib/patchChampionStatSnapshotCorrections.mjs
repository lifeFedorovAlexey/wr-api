import {
  applyPatchDataSnapshotCorrections,
  buildPatchDataSnapshotCorrectionPlan,
  serializePatchDataSnapshotCorrectionsForDb,
} from "./patchDataSnapshotCorrections.mjs";

export const CHAMPION_BASE_STATS_SNAPSHOT_CORRECTION_REASON =
  "Added the declared Hub champion roster count to current-baseline source evidence.";

const DATASET = "champion-base-stats";
const SOURCE_KIND = "hub-game-champion-stats-baseline";
const SOURCE_URL = "https://hub-game.com/wildrift/en/champions/stats";

export function assertLocalPatchChampionStatCorrectionDatabaseTarget(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must identify a local database for --write-local");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("--write-local is restricted to a loopback DATABASE_URL host");
  }
}

function baselineEvidence(row, label, { requireRosterCount = false } = {}) {
  const entries = Array.isArray(row.sourceEvidence)
    ? row.sourceEvidence.filter((entry) => entry?.kind === SOURCE_KIND)
    : [];
  if (entries.length !== 1) throw new Error(`${label} must have exactly one Hub champion source evidence row`);
  const evidence = entries[0];
  const source = row.state?.source;
  const aligned = [
    Array.isArray(row.sourceEvidence) && row.sourceEvidence.length === 1,
    row.dataset === DATASET,
    row.entityKind === "champion",
    row.sourceKind === SOURCE_KIND,
    row.sourceUrl === SOURCE_URL,
    evidence.url === SOURCE_URL,
    evidence.role === undefined || evidence.role === "champion-stats",
    evidence.globalPatchThrough === row.patchVersion,
    evidence.sourcePatchVersion === row.sourcePatchVersion,
    evidence.sourceUpdatedAt === row.sourceUpdatedAt,
    source?.sourceKind === SOURCE_KIND,
    source?.sourceUrl === SOURCE_URL,
    source?.patchVersion === row.patchVersion,
    source?.sourcePatchVersion === row.sourcePatchVersion,
    source?.sourceUpdatedAt === row.sourceUpdatedAt,
  ].every(Boolean);
  if (!aligned) {
    throw new Error(`${label} is not aligned to the declared Hub champion baseline`);
  }
  if (requireRosterCount
    && (evidence.role !== "champion-stats"
      || !Number.isSafeInteger(evidence.listedChampionCount)
      || evidence.listedChampionCount < 1)) {
    throw new Error(`${label} has no valid listedChampionCount source evidence`);
  }
  return evidence;
}

function validateIncomingRoster(incomingRows) {
  if (!Array.isArray(incomingRows) || incomingRows.length === 0) {
    throw new Error("Hub champion source produced no correction candidates");
  }
  const first = incomingRows[0];
  for (const row of incomingRows) baselineEvidence(row, `Incoming champion ${row.entitySlug}`, { requireRosterCount: true });
  const declaredCounts = new Set(incomingRows.map((row) => baselineEvidence(
    row,
    `Incoming champion ${row.entitySlug}`,
    { requireRosterCount: true },
  ).listedChampionCount));
  if (declaredCounts.size !== 1 || declaredCounts.values().next().value !== incomingRows.length) {
    throw new Error("Hub champion listedChampionCount does not match the parsed full roster");
  }
  const sourceMetadata = new Set(incomingRows.map((row) => JSON.stringify([
    row.patchVersion,
    row.sourcePatchVersion,
    row.sourceUpdatedAt,
  ])));
  if (sourceMetadata.size !== 1 || first.patchVersion !== first.sourceEvidence[0].globalPatchThrough) {
    throw new Error("Incoming champion rows mix Hub snapshot provenance");
  }
}

/** Build append-only provenance corrections without changing immutable champion snapshot rows. */
export function buildPatchChampionStatSnapshotCorrectionPlan({
  existingSnapshots,
  incomingRows,
  corrections = [],
}) {
  if (!Array.isArray(existingSnapshots) || !Array.isArray(corrections)) {
    throw new TypeError("existingSnapshots and corrections must be arrays");
  }
  validateIncomingRoster(incomingRows);
  for (const row of existingSnapshots.filter((snapshot) => (
    snapshot.patchVersion === incomingRows[0].patchVersion && snapshot.dataset === DATASET
  ))) {
    baselineEvidence(row, `Existing champion ${row.entitySlug}`);
    const evidence = row.sourceEvidence.find((entry) => entry?.kind === SOURCE_KIND);
    if (evidence.listedChampionCount !== undefined
      && evidence.listedChampionCount !== incomingRows.length) {
      throw new Error(`Existing champion ${row.entitySlug} has conflicting listedChampionCount provenance`);
    }
  }

  return buildPatchDataSnapshotCorrectionPlan({
    existingSnapshots,
    incomingRows,
    corrections: corrections.filter((row) => row.dataset === DATASET),
    reason: CHAMPION_BASE_STATS_SNAPSHOT_CORRECTION_REASON,
    olderSourceErrorLabel: "Hub champion baseline",
    validateIncomingRow: (row, baselineVersion, dataset) => {
      if (dataset !== DATASET || row.patchVersion !== baselineVersion) {
        throw new Error(`Incoming champion row is outside the Hub baseline: ${row.entitySlug}`);
      }
      baselineEvidence(row, `Incoming champion ${row.entitySlug}`, { requireRosterCount: true });
    },
    classifyExistingRow: (row, incoming, baselineVersion, dataset) => (
      row.dataset !== dataset
      || row.entityKind !== "champion"
      || row.sourceKind !== SOURCE_KIND
      || row.sourceUrl !== SOURCE_URL
      || row.patchVersion !== baselineVersion
      ? "existing snapshot is not from this Hub champion baseline"
      : null
    ),
  });
}

export function assertCompletePatchChampionStatCorrectionPlan(plan) {
  const unresolved = [
    ...plan.unmatchedExisting.map((entitySlug) => `existing:${entitySlug}`),
    ...plan.unmatchedIncoming.map((entitySlug) => `incoming:${entitySlug}`),
    ...plan.skipped.map(({ entitySlug }) => `skipped:${entitySlug}`),
  ];
  if (unresolved.length) {
    throw new Error(`Refusing champion source correction with unresolved roster rows: ${unresolved.join(", ")}`);
  }
}

export function applyPatchChampionStatSnapshotCorrections(snapshots, corrections = []) {
  return applyPatchDataSnapshotCorrections(
    snapshots,
    corrections.filter((correction) => correction.dataset === DATASET),
  );
}

export function serializePatchChampionStatSnapshotCorrectionsForDb(corrections) {
  return serializePatchDataSnapshotCorrectionsForDb(corrections);
}
