import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  applyPatchDataSnapshotCorrections,
  buildPatchDataSnapshotCorrectionPlan,
  canonicalPatchSnapshotStateHash,
  serializePatchDataSnapshotCorrectionsForDb,
} from "../lib/patchDataSnapshotCorrections.mjs";
import { buildPublicPatchReferenceData } from "../lib/publicPatchReferenceData.mjs";

const PATCH = "7.3b";
const SOURCE_URL = "https://hub-game.com/wildrift/en/runes";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runeSnapshot(entitySlug, state, overrides = {}) {
  return {
    patchVersion: PATCH,
    dataset: "runes",
    entityKind: "rune",
    entitySlug,
    state,
    contentHash: hash(state),
    sourceKind: "hub-game",
    sourceUrl: SOURCE_URL,
    sourcePatchVersion: PATCH,
    sourceUpdatedAt: "2026-10-16",
    verificationStatus: "verified",
    sourceEvidence: [{
      kind: "hub-game",
      role: "rune-catalog",
      url: SOURCE_URL,
      sourcePatchVersion: PATCH,
      sourceUpdatedAt: "2026-10-16",
      listedRuneCount: 1,
    }],
    ...overrides,
  };
}

const pendingState = {
  name: "Legend: Haste",
  slugSource: "icon-filename",
  path: "Precision",
  category: "Precision",
  image: "https://hub-game.com/wildrift/images/runes/pending.svg",
  description: "Takedowns grant Ability Haste.",
  values: [],
  effectText: "Takedowns grant Ability Haste.",
  valueLineCoverage: { sourceFormat: "description-only", sourceValueLineCount: 0, nonEmptySourceValueLineCount: 0, numericFactsDerived: 0 },
  dataCoverage: "catalog-card-description-only",
  valuesPreservedAsSourceText: true,
  snapshotScope: "current-baseline",
  historicalReconstruction: "not-performed",
  source: { sourceLocale: "en", snapshotScope: "current-baseline", historicalReconstruction: "not-performed" },
};

const canonicalState = {
  ...pendingState,
  slugSource: "heading-name-placeholder-icon",
};

const sourceEvidence = [{
  kind: "hub-game",
  role: "rune-catalog",
  url: SOURCE_URL,
  sourcePatchVersion: PATCH,
  sourceUpdatedAt: "2026-10-16",
  listedRuneCount: 1,
}];

function incomingRune() {
  return runeSnapshot("legend-haste", canonicalState, { sourceEvidence });
}

test("plans and replays a generic rune identity correction, then projects its canonical slug", () => {
  const existing = runeSnapshot("pending", pendingState);
  const incoming = incomingRune();
  const reason = "Use the source heading as the canonical rune identity while retaining its pending icon.";
  const plan = buildPatchDataSnapshotCorrectionPlan({
    existingSnapshots: [existing],
    incomingRows: [incoming],
    corrections: [],
    identityMappings: [{ from: "pending", to: "legend-haste" }],
    reason,
  });

  assert.equal(plan.correctionCount, 1);
  assert.deepEqual(plan.unmatchedExisting, []);
  assert.deepEqual(plan.unmatchedIncoming, []);
  assert.equal(plan.corrections[0].entitySlug, "pending");
  assert.equal(plan.corrections[0].correctedEntitySlug, "legend-haste");
  assert.equal(plan.corrections[0].correctedContentHash, canonicalPatchSnapshotStateHash(canonicalState));

  const correction = { ...plan.corrections[0], id: 1 };
  const effective = applyPatchDataSnapshotCorrections([existing], [correction]);
  assert.equal(effective.length, 1);
  assert.equal(effective[0].entitySlug, "legend-haste");
  assert.equal(effective[0].state.name, "Legend: Haste");
  assert.equal(effective[0].latestCorrection.correctedEntitySlug, "legend-haste");

  const projected = buildPublicPatchReferenceData([existing], "runes", [correction]);
  assert.deepEqual(projected.entries.map((entry) => entry.slug), ["legend-haste"]);
  assert.equal(projected.entries[0].name, "Legend: Haste");
  assert.equal(projected.entries[0].state.image, pendingState.image);

  const revisedState = { ...canonicalState, description: "Revised source description." };
  const revisedIncoming = runeSnapshot("legend-haste", revisedState, { sourceEvidence });
  const chainPlan = buildPatchDataSnapshotCorrectionPlan({
    existingSnapshots: [existing],
    incomingRows: [revisedIncoming],
    corrections: [correction],
    reason: "Apply a later source correction after the identity was canonicalized.",
  });
  assert.equal(chainPlan.correctionCount, 1);
  assert.equal(chainPlan.corrections[0].entitySlug, "legend-haste");
  const chainedEffective = applyPatchDataSnapshotCorrections(
    [existing],
    [correction, { ...chainPlan.corrections[0], id: 2 }],
  );
  assert.equal(chainedEffective[0].entitySlug, "legend-haste");
  assert.equal(chainedEffective[0].state.description, "Revised source description.");

  const repeatedPlan = buildPatchDataSnapshotCorrectionPlan({
    existingSnapshots: [existing],
    incomingRows: [incoming],
    corrections: [correction],
    identityMappings: [{ from: "pending", to: "legend-haste" }],
    reason,
  });
  assert.equal(repeatedPlan.correctionCount, 0);
  assert.deepEqual(repeatedPlan.unchangedExisting, ["legend-haste"]);
});

test("serializes canonical slug corrections while legacy item corrections remain null-slug compatible", () => {
  const correction = {
    patchVersion: PATCH,
    dataset: "runes",
    entityKind: "rune",
    entitySlug: "pending",
    correctedEntitySlug: "legend-haste",
    previousContentHash: "previous",
    correctedContentHash: "corrected",
    correctedState: canonicalState,
    sourceKind: "hub-game",
    sourceUrl: SOURCE_URL,
    sourcePatchVersion: PATCH,
    sourceUpdatedAt: "2026-10-16",
    verificationStatus: "verified",
    sourceEvidence,
    reason: "fixture",
    correctionHash: "record-hash",
  };
  const legacyItem = { ...correction, dataset: "items", entitySlug: "old-item" };
  delete legacyItem.correctedEntitySlug;

  const serialized = JSON.parse(serializePatchDataSnapshotCorrectionsForDb([correction, legacyItem]));
  assert.equal(serialized[0].corrected_entity_slug, "legend-haste");
  assert.equal(serialized[1].corrected_entity_slug, null);
});

test("rejects a stale content hash and canonical slug collision during replay", () => {
  const existing = runeSnapshot("pending", pendingState);
  const baseCorrection = {
    patchVersion: PATCH,
    dataset: "runes",
    entityKind: "rune",
    entitySlug: "pending",
    correctedEntitySlug: "legend-haste",
    previousContentHash: "stale-hash",
    correctedContentHash: canonicalPatchSnapshotStateHash(canonicalState),
    correctedState: canonicalState,
    sourceKind: "hub-game",
    sourceUrl: SOURCE_URL,
    sourcePatchVersion: PATCH,
    sourceUpdatedAt: "2026-10-16",
    verificationStatus: "verified",
    sourceEvidence,
    reason: "fixture",
  };
  assert.throws(() => applyPatchDataSnapshotCorrections([existing], [baseCorrection]), /prior snapshot/);

  const matching = { ...baseCorrection, previousContentHash: existing.contentHash };
  const collision = runeSnapshot("legend-haste", canonicalState);
  assert.throws(
    () => applyPatchDataSnapshotCorrections([existing, collision], [matching]),
    /duplicate canonical slug/,
  );
});
