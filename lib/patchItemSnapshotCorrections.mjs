import {
  applyPatchDataSnapshotCorrections,
  buildPatchDataSnapshotCorrectionPlan,
  mapPatchDataSnapshotCorrectionToDbRow,
  serializePatchDataSnapshotCorrectionsForDb,
} from "./patchDataSnapshotCorrections.mjs";

export const PATCH_ITEM_SNAPSHOT_CORRECTION_REASON =
  "Reparsed from the complete Hub Game item catalog and all linked detail pages.";

export function assertLocalPatchItemCorrectionDatabaseTarget(databaseUrl) {
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

/** Map correction-plan records to the snake_case field names consumed by jsonb_to_recordset. */
export function mapPatchItemSnapshotCorrectionToDbRow(correction) {
  return mapPatchDataSnapshotCorrectionToDbRow(correction);
}

export function serializePatchItemSnapshotCorrectionsForDb(corrections) {
  return serializePatchDataSnapshotCorrectionsForDb(corrections);
}

function sourceCatalogEvidence(row) {
  return Array.isArray(row.sourceEvidence)
    ? row.sourceEvidence.find((evidence) => evidence.role === "item-catalog") ?? null
    : null;
}

/** Replay append-only corrections against their exact previous state; never mutate source rows. */
export function applyPatchItemSnapshotCorrections(snapshots, corrections = []) {
  if (!Array.isArray(corrections)) throw new TypeError("corrections must be an array");
  return applyPatchDataSnapshotCorrections(
    snapshots,
    corrections.filter((correction) => correction.dataset === "items"),
  );
}

/** Plan generic source corrections for changed rows in the exact current Hub item baseline. */
export function buildPatchItemSnapshotCorrectionPlan({ existingSnapshots, incomingRows, corrections = [] }) {
  return buildPatchDataSnapshotCorrectionPlan({
    existingSnapshots,
    incomingRows,
    corrections: corrections.filter((correction) => correction.dataset === "items"),
    reason: PATCH_ITEM_SNAPSHOT_CORRECTION_REASON,
    olderSourceErrorLabel: "item source snapshot",
    getSourceUpdatedAt: (row) => sourceCatalogEvidence(row)?.sourceUpdatedAt || row.sourceUpdatedAt,
    validateIncomingRow: (row, baselineVersion) => {
      const evidence = sourceCatalogEvidence(row);
      if (row.sourceKind !== "hub-game" || evidence?.sourcePatchVersion !== baselineVersion || !evidence.sourceUpdatedAt) {
        throw new Error(`Incoming item row is not from an exact Hub current baseline: ${row.entitySlug}`);
      }
    },
    classifyExistingRow: (row, incoming, baselineVersion) => {
      const evidence = sourceCatalogEvidence(row);
      return row.sourceKind !== "hub-game" || evidence?.sourcePatchVersion !== baselineVersion
        ? "existing snapshot is not the same Hub baseline"
        : null;
    },
  });
}
