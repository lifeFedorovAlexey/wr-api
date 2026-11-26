import { createHash } from "node:crypto";

const CORRECTION_DB_FIELDS = {
  patchVersion: "patch_version",
  dataset: "dataset",
  entityKind: "entity_kind",
  entitySlug: "entity_slug",
  correctedEntitySlug: "corrected_entity_slug",
  previousContentHash: "previous_content_hash",
  correctedContentHash: "corrected_content_hash",
  correctedState: "corrected_state",
  sourceKind: "source_kind",
  sourceUrl: "source_url",
  sourcePatchVersion: "source_patch_version",
  sourceUpdatedAt: "source_updated_at",
  verificationStatus: "verification_status",
  sourceEvidence: "source_evidence",
  reason: "reason",
  correctionHash: "correction_hash",
};

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value ?? null));
}

export function canonicalPatchSnapshotStateHash(value) {
  return stableHash(canonicalize(value));
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function identityKey(row, entitySlug = row.entitySlug) {
  return `${row.patchVersion}\u0000${row.dataset}\u0000${entitySlug}`;
}

function contentHashFor(row) {
  return row.contentHash || stableHash(row.state);
}

function correctionOrder(left, right) {
  if (Number.isInteger(left.id) && Number.isInteger(right.id)) return left.id - right.id;
  return 0;
}

function validateCorrectionState(correction) {
  if (!correction.correctedState || typeof correction.correctedState !== "object" || Array.isArray(correction.correctedState)) {
    throw new Error(`Snapshot correction has an invalid corrected state: ${correction.dataset}/${correction.entitySlug}`);
  }
}

function registerAlias(aliases, aliasKey, rootKey) {
  const owner = aliases.get(aliasKey);
  if (owner && owner !== rootKey) {
    throw new Error(`Snapshot correction creates a duplicate canonical slug: ${aliasKey.split("\u0000").at(-1)}`);
  }
  aliases.set(aliasKey, rootKey);
}

/**
 * Replay immutable snapshot corrections. `entitySlug` identifies the slug at the
 * start of that correction step; `correctedEntitySlug` optionally changes the
 * canonical slug while the alias map preserves later correction-chain lookup.
 */
export function applyPatchDataSnapshotCorrections(snapshots, corrections = []) {
  if (!Array.isArray(snapshots) || !Array.isArray(corrections)) {
    throw new TypeError("snapshots and corrections must be arrays");
  }

  const effective = new Map();
  const aliases = new Map();
  for (const snapshot of snapshots) {
    const patchVersion = requiredText(snapshot.patchVersion, "snapshot.patchVersion");
    const dataset = requiredText(snapshot.dataset, "snapshot.dataset");
    const entitySlug = requiredText(snapshot.entitySlug, "snapshot.entitySlug");
    if (!snapshot.state || typeof snapshot.state !== "object" || Array.isArray(snapshot.state)) {
      throw new TypeError(`Snapshot has an invalid state: ${dataset}/${entitySlug}`);
    }
    const key = identityKey({ patchVersion, dataset, entitySlug });
    if (effective.has(key)) throw new Error(`Duplicate snapshot identity: ${dataset}/${entitySlug}`);
    effective.set(key, { ...snapshot, contentHash: contentHashFor(snapshot) });
    registerAlias(aliases, key, key);
  }

  for (const correction of [...corrections].sort(correctionOrder)) {
    const correctionPatch = requiredText(correction.patchVersion, "correction.patchVersion");
    const correctionDataset = requiredText(correction.dataset, "correction.dataset");
    const correctionSlug = requiredText(correction.entitySlug, "correction.entitySlug");
    const aliasKey = identityKey({ patchVersion: correctionPatch, dataset: correctionDataset, entitySlug: correctionSlug });
    const rootKey = aliases.get(aliasKey);
    const current = rootKey ? effective.get(rootKey) : null;
    if (!current) throw new Error(`Snapshot correction has no base snapshot: ${correctionDataset}/${correctionSlug}`);
    if (correction.entityKind && correction.entityKind !== current.entityKind) {
      throw new Error(`Snapshot correction entity kind does not match its base snapshot: ${correctionDataset}/${correctionSlug}`);
    }
    if (correction.previousContentHash !== current.contentHash) {
      throw new Error(`Snapshot correction chain does not match the prior snapshot: ${correctionDataset}/${correctionSlug}`);
    }
    validateCorrectionState(correction);
    const correctedContentHash = canonicalPatchSnapshotStateHash(correction.correctedState);
    if (correction.correctedContentHash !== correctedContentHash) {
      throw new Error(`Snapshot correction hash does not match its corrected state: ${correctionDataset}/${correctionSlug}`);
    }

    const correctedEntitySlug = correction.correctedEntitySlug == null
      ? current.entitySlug
      : requiredText(correction.correctedEntitySlug, "correction.correctedEntitySlug");
    const correctedAliasKey = identityKey(current, correctedEntitySlug);
    registerAlias(aliases, correctedAliasKey, rootKey);
    effective.set(rootKey, {
      ...current,
      entitySlug: correctedEntitySlug,
      state: correction.correctedState,
      contentHash: correctedContentHash,
      sourceKind: correction.sourceKind,
      sourceUrl: correction.sourceUrl,
      sourcePatchVersion: correction.sourcePatchVersion ?? null,
      sourceUpdatedAt: correction.sourceUpdatedAt,
      verificationStatus: correction.verificationStatus,
      sourceEvidence: correction.sourceEvidence,
      latestCorrection: {
        id: correction.id ?? null,
        reason: correction.reason,
        createdAt: correction.createdAt ?? null,
        previousContentHash: correction.previousContentHash,
        correctedContentHash,
        ...(correctedEntitySlug !== current.entitySlug ? { correctedEntitySlug } : {}),
      },
    });
  }

  const result = [...effective.values()];
  const canonicalIdentities = new Set();
  for (const row of result) {
    const key = identityKey(row);
    if (canonicalIdentities.has(key)) {
      throw new Error(`Snapshot corrections produce duplicate canonical identity: ${row.dataset}/${row.entitySlug}`);
    }
    canonicalIdentities.add(key);
  }
  return result;
}

function normalizeIdentityMappings(identityMappings) {
  if (!Array.isArray(identityMappings)) throw new TypeError("identityMappings must be an array");
  const fromTo = new Map();
  const targets = new Set();
  for (const mapping of identityMappings) {
    const from = requiredText(mapping?.from, "identity mapping from");
    const to = requiredText(mapping?.to, "identity mapping to");
    if (from === to || fromTo.has(from) || targets.has(to)) {
      throw new Error("Snapshot identity mappings must be unique one-to-one slug changes");
    }
    fromTo.set(from, to);
    targets.add(to);
  }
  return fromTo;
}

function mappingMatchesNames(existing, incoming) {
  const existingName = String(existing.state?.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
  const incomingName = String(incoming.state?.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
  return existingName && existingName === incomingName;
}

function incomingSourceDate(row, getSourceUpdatedAt) {
  return String(getSourceUpdatedAt(row) ?? row.sourceUpdatedAt ?? "").trim();
}

/**
 * Plan immutable corrections for one source snapshot. Callers validate the
 * source-specific evidence before allowing corrections; slug changes require
 * an explicit one-to-one identity mapping.
 */
export function buildPatchDataSnapshotCorrectionPlan({
  existingSnapshots,
  incomingRows,
  corrections = [],
  identityMappings = [],
  reason,
  validateIncomingRow = null,
  classifyExistingRow = null,
  getSourceUpdatedAt = (row) => row.sourceUpdatedAt,
  olderSourceErrorLabel = "source snapshot",
}) {
  if (!Array.isArray(existingSnapshots) || !Array.isArray(incomingRows) || !Array.isArray(corrections)) {
    throw new TypeError("existingSnapshots, incomingRows, and corrections must be arrays");
  }
  if (!incomingRows.length) throw new Error("Source produced no snapshot correction candidates");
  const correctionReason = requiredText(reason, "reason");
  const baselineVersion = requiredText(incomingRows[0].patchVersion, "incoming patchVersion");
  const dataset = requiredText(incomingRows[0].dataset, "incoming dataset");
  const mappings = normalizeIdentityMappings(identityMappings);
  const incomingBySlug = new Map();
  for (const row of incomingRows) {
    if (row.patchVersion !== baselineVersion || row.dataset !== dataset) {
      throw new Error("Incoming rows must belong to one dataset snapshot");
    }
    requiredText(row.entityKind, "incoming entityKind");
    requiredText(row.entitySlug, "incoming entitySlug");
    if (!row.state || typeof row.state !== "object" || Array.isArray(row.state)) {
      throw new Error(`Incoming snapshot row has an invalid state: ${row.entitySlug}`);
    }
    requiredText(row.sourceKind, `incoming ${row.entitySlug} sourceKind`);
    requiredText(row.sourceUrl, `incoming ${row.entitySlug} sourceUrl`);
    requiredText(row.verificationStatus, `incoming ${row.entitySlug} verificationStatus`);
    if (!Array.isArray(row.sourceEvidence) || row.sourceEvidence.length === 0) {
      throw new Error(`Incoming snapshot row has no source evidence: ${row.entitySlug}`);
    }
    if (!incomingSourceDate(row, getSourceUpdatedAt)) {
      throw new Error(`Incoming snapshot row has no source update date: ${row.entitySlug}`);
    }
    validateIncomingRow?.(row, baselineVersion, dataset);
    if (incomingBySlug.has(row.entitySlug)) throw new Error(`Duplicate incoming snapshot row: ${row.entitySlug}`);
    incomingBySlug.set(row.entitySlug, row);
  }

  const relevantExisting = existingSnapshots.filter((row) => row.patchVersion === baselineVersion && row.dataset === dataset);
  const relevantCorrections = corrections.filter((row) => row.patchVersion === baselineVersion && row.dataset === dataset);
  const effectiveExisting = applyPatchDataSnapshotCorrections(relevantExisting, relevantCorrections);
  const existingBySlug = new Map(effectiveExisting.map((row) => [row.entitySlug, row]));
  if (existingBySlug.size !== effectiveExisting.length) throw new Error("Existing snapshot has duplicate canonical slugs");

  const planned = [];
  const skipped = [];
  const unchangedExisting = [];
  const matchedExisting = new Set();
  const matchedIncoming = new Set();

  const createCorrection = (existing, incoming) => {
    if (existing.entityKind !== incoming.entityKind) {
      throw new Error(`Snapshot identity mapping changes entity kind: ${existing.entitySlug} -> ${incoming.entitySlug}`);
    }
    if (existing.entitySlug !== incoming.entitySlug && !mappingMatchesNames(existing, incoming)) {
      throw new Error(`Snapshot identity mapping names do not match: ${existing.entitySlug} -> ${incoming.entitySlug}`);
    }
    const existingDate = incomingSourceDate(existing, getSourceUpdatedAt);
    const incomingDate = incomingSourceDate(incoming, getSourceUpdatedAt);
    if (existingDate && incomingDate < existingDate) {
      throw new Error(`Refusing an older ${olderSourceErrorLabel} for ${incoming.entitySlug}`);
    }
    const skipReason = classifyExistingRow?.(existing, incoming, baselineVersion, dataset);
    if (skipReason) {
      skipped.push({ entitySlug: incoming.entitySlug, reason: skipReason });
      matchedExisting.add(existing.entitySlug);
      matchedIncoming.add(incoming.entitySlug);
      return;
    }

    const previousContentHash = contentHashFor(existing);
    const correctedContentHash = canonicalPatchSnapshotStateHash(incoming.state);
    const slugChanged = existing.entitySlug !== incoming.entitySlug;
    const stateChanged = canonicalPatchSnapshotStateHash(existing.state) !== correctedContentHash;
    const sourceMetadataChanged = existing.sourceKind !== incoming.sourceKind
      || existing.sourceUrl !== incoming.sourceUrl
      || (existing.sourcePatchVersion ?? null) !== (incoming.sourcePatchVersion ?? null)
      || existingDate !== incomingDate
      || existing.verificationStatus !== incoming.verificationStatus
      || canonicalJson(existing.sourceEvidence) !== canonicalJson(incoming.sourceEvidence);
    if (!slugChanged && !stateChanged && !sourceMetadataChanged) {
      unchangedExisting.push(incoming.entitySlug);
      matchedExisting.add(existing.entitySlug);
      matchedIncoming.add(incoming.entitySlug);
      return;
    }

    const correction = {
      patchVersion: incoming.patchVersion,
      dataset: incoming.dataset,
      entityKind: incoming.entityKind,
      entitySlug: existing.entitySlug,
      correctedEntitySlug: slugChanged ? incoming.entitySlug : null,
      previousContentHash,
      correctedContentHash,
      correctedState: incoming.state,
      sourceKind: incoming.sourceKind,
      sourceUrl: incoming.sourceUrl,
      sourcePatchVersion: incoming.sourcePatchVersion ?? null,
      sourceUpdatedAt: incomingSourceDate(incoming, getSourceUpdatedAt),
      verificationStatus: incoming.verificationStatus,
      sourceEvidence: incoming.sourceEvidence,
      reason: correctionReason,
    };
    correction.correctionHash = stableHash(correction);
    planned.push(correction);
    matchedExisting.add(existing.entitySlug);
    matchedIncoming.add(incoming.entitySlug);
  };

  for (const [fromSlug, toSlug] of mappings) {
    const incoming = incomingBySlug.get(toSlug);
    if (!incoming) throw new Error(`Snapshot identity mapping target is absent from source: ${toSlug}`);
    const existingFrom = existingBySlug.get(fromSlug);
    const existingTo = existingBySlug.get(toSlug);
    if (existingFrom && existingTo && existingFrom !== existingTo) {
      throw new Error(`Snapshot identity mapping collides with an existing canonical slug: ${toSlug}`);
    }
    const existing = existingFrom || existingTo;
    if (!existing) continue;
    if (incomingBySlug.has(fromSlug)) {
      throw new Error(`Snapshot identity mapping source slug is also present in source: ${fromSlug}`);
    }
    createCorrection(existing, incoming);
  }

  for (const [slug, incoming] of incomingBySlug) {
    if (matchedIncoming.has(slug)) continue;
    const existing = existingBySlug.get(slug);
    if (!existing) continue;
    createCorrection(existing, incoming);
  }

  const unmatchedExisting = effectiveExisting
    .filter((row) => !matchedExisting.has(row.entitySlug))
    .map((row) => row.entitySlug)
    .sort();
  const unmatchedIncoming = [...incomingBySlug.keys()]
    .filter((slug) => !matchedIncoming.has(slug))
    .sort();

  return {
    patchVersion: baselineVersion,
    dataset,
    correctionCount: planned.length,
    corrections: planned,
    skipped,
    unchangedExisting: unchangedExisting.sort(),
    unmatchedExisting,
    unmatchedIncoming,
  };
}

/** Map a correction to the snake_case columns consumed by jsonb_to_recordset. */
export function mapPatchDataSnapshotCorrectionToDbRow(correction) {
  if (!correction || typeof correction !== "object" || Array.isArray(correction)) {
    throw new TypeError("A patch data snapshot correction record is required");
  }
  const row = Object.fromEntries(Object.entries(CORRECTION_DB_FIELDS)
    .map(([property, column]) => [column, correction[property]]));
  row.corrected_entity_slug = correction.correctedEntitySlug ?? null;
  return row;
}

export function serializePatchDataSnapshotCorrectionsForDb(corrections) {
  if (!Array.isArray(corrections)) throw new TypeError("corrections must be an array");
  return JSON.stringify(corrections.map(mapPatchDataSnapshotCorrectionToDbRow));
}
