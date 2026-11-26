import { applyPatchDataSnapshotCorrections } from "./patchDataSnapshotCorrections.mjs";
import { isValidPatchVersion } from "./patchVersion.mjs";
import { findHubSummonerSpellNumericConflicts } from "./hubSummonerSpellNumericConflicts.mjs";

function sourceUpdateKey(row) {
  return String(row.sourceUpdatedAt || row.state?.source?.sourceUpdatedAt || "");
}

function isCurrentBaseline(row) {
  const state = row.state || {};
  return state.snapshotScope === "current-baseline"
    || state.source?.snapshotScope === "current-baseline"
    || state.historicalReconstruction === "not-performed"
    || state.source?.historicalReconstruction === "not-performed";
}

function compareSnapshots(left, right) {
  return sourceUpdateKey(right).localeCompare(sourceUpdateKey(left))
    || String(right.patchVersion || "").localeCompare(String(left.patchVersion || ""));
}

function assertSameSource(rows, dataset) {
  const first = rows[0];
  const keys = ["patchVersion", "sourceKind", "sourceUrl", "sourcePatchVersion", "sourceUpdatedAt"];
  const conflicts = keys.filter((key) => rows.some((row) => (row[key] ?? null) !== (first[key] ?? null)));
  if (conflicts.length) {
    throw new Error(`Mixed source metadata in ${dataset} current snapshot: ${conflicts.join(", ")}`);
  }
}

function hasCompleteSummonerSpellCatalog(rows) {
  const evidenceRows = rows.map((row) => Array.isArray(row.sourceEvidence)
    ? row.sourceEvidence.filter((evidence) => evidence?.role === "summoner-spell-catalog")
    : []);
  if (evidenceRows.some((evidence) => evidence.length !== 1)) return false;
  const first = evidenceRows[0][0];
  const sourceKey = (evidence) => JSON.stringify([
    evidence.kind,
    evidence.url,
    evidence.sourceUpdatedAt,
    evidence.listedSpellCount,
    evidence.patchCoverage?.status,
    evidence.patchCoverage?.throughPatch,
  ]);
  return Number.isInteger(first.listedSpellCount)
    && first.listedSpellCount === rows.length
    && evidenceRows.every((evidence) => sourceKey(evidence[0]) === sourceKey(first));
}

function hasCompleteRuneCatalog(rows) {
  const evidenceRows = rows.map((row) => Array.isArray(row.sourceEvidence)
    ? row.sourceEvidence.filter((evidence) => evidence?.role === "rune-catalog")
    : []);
  if (evidenceRows.some((evidence) => evidence.length !== 1)) return false;
  const first = evidenceRows[0][0];
  const sourceKey = (evidence) => JSON.stringify([
    evidence.kind,
    evidence.url,
    evidence.sourcePatchVersion,
    evidence.sourceUpdatedAt,
    evidence.listedRuneCount,
  ]);
  return Number.isSafeInteger(first.listedRuneCount)
    && first.listedRuneCount === rows.length
    && new Set(rows.map((row) => row.entitySlug)).size === rows.length
    && evidenceRows.every((evidence) => sourceKey(evidence[0]) === sourceKey(first));
}

function isCompleteReferenceDataset(dataset, rows) {
  if (dataset === "runes") return hasCompleteRuneCatalog(rows);
  if (dataset === "summoner-spells") return hasCompleteSummonerSpellCatalog(rows);
  return true;
}

function runeSourceValueLines(state) {
  return Array.isArray(state?.values)
    ? state.values.filter((line) => typeof line?.label === "string" && line.label.trim()
      && typeof line?.value === "string" && line.value.trim())
    : [];
}

function runeMechanicsStatus(state) {
  if (state?.mechanicsCoverage?.status === "verified"
    && Array.isArray(state.mechanicsFacts)
    && state.mechanicsCoverage.complete === true) return "verified";
  return runeSourceValueLines(state).length ? "source-values-only" : "description-only";
}

function runeMechanicsCoverage(rows) {
  const withSourceValueLines = rows.filter((row) => runeSourceValueLines(row.state).length > 0).length;
  const descriptionOnly = rows.length - withSourceValueLines;
  const normalized = rows.filter((row) => runeMechanicsStatus(row.state) === "verified");
  const normalizedNumericFactCount = normalized.reduce((sum, row) => sum
    + (Array.isArray(row.state?.mechanicsFacts) ? row.state.mechanicsFacts.length : 0), 0);
  return {
    status: normalized.length === rows.length ? "verified" : "partial",
    complete: normalized.length === rows.length,
    totalRuneCount: rows.length,
    sourceValueLineRuneCount: withSourceValueLines,
    descriptionOnlyRuneCount: descriptionOnly,
    normalizedMechanicsRuneCount: normalized.length,
    normalizedNumericFactCount,
    numericFactsDerived: 0,
  };
}

/** Project the most recently updated explicitly current reference snapshot without treating it as patch history. */
export function buildPublicPatchReferenceData(snapshots, dataset, corrections = [], requestedPatchVersion = null) {
  if (!Array.isArray(snapshots)) throw new TypeError("Reference snapshots must be an array");
  if (typeof dataset !== "string" || !dataset.trim()) throw new TypeError("A reference dataset name is required");
  if (!Array.isArray(corrections)) throw new TypeError("Reference snapshot corrections must be an array");
  if (requestedPatchVersion !== null && (typeof requestedPatchVersion !== "string" || !requestedPatchVersion.trim())) {
    throw new TypeError("requestedPatchVersion must be a non-empty string when provided");
  }

  const datasetSnapshots = snapshots.filter((row) => row.dataset === dataset);
  const effectiveSnapshots = applyPatchDataSnapshotCorrections(
    datasetSnapshots,
    corrections.filter((row) => row.dataset === dataset),
  );
  const currentRows = effectiveSnapshots.filter((row) => isCurrentBaseline(row));
  if (!currentRows.length) return null;

  const sortedRows = [...currentRows].sort(compareSnapshots);
  const latestVersion = sortedRows[0].patchVersion;
  const latestUpdatedAt = sourceUpdateKey(sortedRows[0]);
  const latestRows = currentRows.filter((row) => row.patchVersion === latestVersion && sourceUpdateKey(row) === latestUpdatedAt);
  assertSameSource(latestRows, dataset);
  if (!isCompleteReferenceDataset(dataset, latestRows)) return null;
  latestRows.sort((left, right) => String(left.entitySlug).localeCompare(String(right.entitySlug)));

  const first = latestRows[0];
  const sourceEvidence = Array.isArray(first.sourceEvidence) ? first.sourceEvidence : [];
  const firstEvidence = sourceEvidence[0] || {};
  const firstStateSource = first.state?.source || {};
  const listedEntityCount = dataset === "runes"
    ? firstEvidence.listedRuneCount
    : dataset === "summoner-spells"
      ? firstEvidence.listedSpellCount
      : null;
  const patchCoverage = first.state?.patchCoverage || firstStateSource.patchCoverage || firstEvidence.patchCoverage || null;
  const historyCoverage = firstEvidence.historyCoverage || firstStateSource.historyCoverage || "not-provided-on-catalog";
  const incompleteRows = latestRows.filter((row) => row.verificationStatus !== "verified").length;
  const cutoffConfirmed = patchCoverage
    ? patchCoverage.status === "declared"
      && isValidPatchVersion(patchCoverage.throughPatch)
      && first.sourcePatchVersion === patchCoverage.throughPatch
    : isValidPatchVersion(first.sourcePatchVersion);
  const sourceExtractionStatus = dataset === "runes"
    ? (incompleteRows > 0 ? "partial" : "verified")
    : null;
  const identityVerificationStatus = dataset === "runes" ? "verified" : null;
  const mechanicsCoverage = dataset === "runes" ? runeMechanicsCoverage(latestRows) : null;
  const verificationStatus = incompleteRows > 0 || !cutoffConfirmed || mechanicsCoverage?.status === "partial"
    ? "partial"
    : "verified";
  return {
    dataset,
    patchVersion: first.patchVersion,
    ...(requestedPatchVersion ? { requestedPatchVersion } : {}),
    snapshotScope: "current-baseline",
    historicalReconstruction: "not-performed",
    historyCoverage,
    count: latestRows.length,
    verificationStatus,
    ...(sourceExtractionStatus ? { sourceExtractionStatus } : {}),
    ...(identityVerificationStatus ? { identityVerificationStatus } : {}),
    ...(mechanicsCoverage ? { mechanicsCoverage } : {}),
    coverage: firstEvidence.coverage || null,
    catalogCoverage: {
      listedEntityCount: Number.isSafeInteger(listedEntityCount) ? listedEntityCount : null,
      snapshotRowCount: latestRows.length,
      complete: Number.isSafeInteger(listedEntityCount) && listedEntityCount === latestRows.length,
      verificationStatus: identityVerificationStatus || verificationStatus,
      ...(identityVerificationStatus ? { identityVerificationStatus } : {}),
      ...(sourceExtractionStatus ? { sourceExtractionStatus } : {}),
      cutoffConfirmed,
    },
    source: {
      kind: first.sourceKind,
      url: first.sourceUrl,
      sourcePatchVersion: first.sourcePatchVersion,
      sourceUpdatedAt: first.sourceUpdatedAt,
      locale: firstStateSource.sourceLocale || "en",
      patchCoverage,
      historyCoverage,
      sourceEvidence,
    },
    entries: latestRows.map((row) => ({
      slug: row.entitySlug,
      name: row.state?.name || row.entitySlug,
      image: row.state?.image || null,
      state: row.state,
      ...(dataset === "summoner-spells" ? {
        numericConflicts: findHubSummonerSpellNumericConflicts({
          name: row.state?.name || row.entitySlug,
          cooldownSeconds: row.state?.cooldownSeconds,
          effectSummary: row.state?.effectSummary,
          structuredDetails: row.state?.structuredDetails,
          faqEvidence: row.state?.faqEvidence,
          knownSpellNames: latestRows.map((candidate) => candidate.state?.name || candidate.entitySlug),
        }),
      } : {}),
      verificationStatus: dataset === "runes" && runeMechanicsStatus(row.state) !== "verified"
        ? "partial"
        : row.verificationStatus,
      ...(dataset === "runes" ? {
        sourceExtractionStatus: row.verificationStatus,
        identityVerificationStatus: "verified",
        mechanicsCoverageStatus: runeMechanicsStatus(row.state),
      } : {}),
    })),
  };
}
