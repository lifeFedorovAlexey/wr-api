import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertLocalPatchItemCorrectionDatabaseTarget,
  applyPatchItemSnapshotCorrections,
  buildPatchItemSnapshotCorrectionPlan,
  mapPatchItemSnapshotCorrectionToDbRow,
  serializePatchItemSnapshotCorrectionsForDb,
} from "../lib/patchItemSnapshotCorrections.mjs";
import { buildPublicPatchItemData } from "../lib/publicPatchItemSnapshots.mjs";

const PATCH = "8.4";
const SOURCE_URL = "https://hub-game.com/wildrift/en/items";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function snapshot(entitySlug, state, overrides = {}) {
  return {
    patchVersion: PATCH,
    dataset: "items",
    entityKind: "item",
    entitySlug,
    state,
    contentHash: hash(state),
    sourceKind: "hub-game",
    sourceUrl: SOURCE_URL,
    sourcePatchVersion: PATCH,
    sourceUpdatedAt: "2026-10-15",
    verificationStatus: "partial",
    sourceEvidence: [{
      kind: "hub-game",
      role: "item-catalog",
      url: SOURCE_URL,
      sourcePatchVersion: PATCH,
      sourceUpdatedAt: "2026-10-15",
    }],
    ...overrides,
  };
}

function incoming(entitySlug, state, overrides = {}) {
  return snapshot(entitySlug, state, {
    sourceUpdatedAt: "2026-10-17",
    sourceEvidence: [{
      kind: "hub-game",
      role: "item-catalog",
      url: SOURCE_URL,
      sourcePatchVersion: PATCH,
      sourceUpdatedAt: "2026-10-17",
    }],
    ...overrides,
  });
}

function canonicalHash(value) {
  const canonical = (part) => {
    if (Array.isArray(part)) return part.map(canonical);
    if (!part || typeof part !== "object") return part;
    return Object.fromEntries(Object.keys(part).sort().map((key) => [key, canonical(part[key])]));
  };
  return hash(canonical(value));
}

test("local correction write guard accepts loopback IPv4, IPv6, and localhost only", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.doesNotThrow(() => assertLocalPatchItemCorrectionDatabaseTarget(`postgres://user:pass@${host}:5432/wr`));
  }
  for (const host of ["db.example.com", "192.168.1.10"]) {
    assert.throws(
      () => assertLocalPatchItemCorrectionDatabaseTarget(`postgres://user:pass@${host}:5432/wr`),
      /restricted to a loopback/,
    );
  }
  assert.throws(() => assertLocalPatchItemCorrectionDatabaseTarget("not a url"), /DATABASE_URL must identify a local database/);
});

test("plans source-backed append-only corrections generically and projects catalog-only availability", () => {
  const oldAvailable = snapshot("catalog-only-item", {
    name: "Catalog Only Item",
    dataCoverage: "catalog-card-only",
    image: "https://hub-game.com/item.webp",
    cost: 1000,
  });
  const oldRemoved = snapshot("explicitly-removed-item", {
    name: "Explicitly Removed Item",
    availability: "available",
    dataCoverage: "detail-page",
    cost: 2000,
  });
  const incomingAvailable = incoming("catalog-only-item", {
    name: "Catalog Only Item",
    availability: "available",
    removedInPatch: null,
    dataCoverage: "catalog-card-only",
    image: "https://hub-game.com/item.webp",
    cost: 1000,
    stats: ["+10 Attack Damage"],
    effects: [],
  });
  const incomingRemoved = incoming("explicitly-removed-item", {
    name: "Explicitly Removed Item",
    availability: "removed",
    removedInPatch: "8.2",
    dataCoverage: "explicit-removal-with-last-known-values",
    lastKnownState: { cost: 2000 },
  }, {
    sourcePatchVersion: "8.2",
    sourceUpdatedAt: "2026-08-15",
    sourceEvidence: [
      {
        kind: "hub-game",
        role: "item-catalog",
        url: SOURCE_URL,
        sourcePatchVersion: PATCH,
        sourceUpdatedAt: "2026-10-17",
      },
      {
        kind: "hub-game",
        role: "item-detail",
        url: "https://hub-game.com/wildrift/en/items/explicitly-removed-item",
        sourcePatchVersion: "8.2",
        sourceUpdatedAt: "2026-08-15",
      },
    ],
  });

  const originals = structuredClone([oldAvailable, oldRemoved]);
  const plan = buildPatchItemSnapshotCorrectionPlan({
    existingSnapshots: [oldAvailable, oldRemoved],
    incomingRows: [incomingAvailable, incomingRemoved],
  });

  assert.equal(plan.patchVersion, PATCH);
  assert.equal(plan.correctionCount, 2);
  assert.deepEqual(plan.unmatchedExisting, []);
  assert.equal(plan.corrections.find((row) => row.entitySlug === "explicitly-removed-item").sourceUpdatedAt, "2026-10-17");
  assert.deepEqual([oldAvailable, oldRemoved], originals, "planning never mutates original baseline rows");

  const correctionRows = plan.corrections.map((row, index) => ({ ...row, id: index + 1 }));
  const effective = applyPatchItemSnapshotCorrections([oldAvailable, oldRemoved], correctionRows);
  const projection = buildPublicPatchItemData(effective, PATCH);
  assert.deepEqual(projection.items.map((row) => row.slug), ["catalog-only-item"]);
  assert.equal(projection.items[0].dataCoverage, "catalog-card-only");
  assert.equal(projection.items[0].provenance.correction.reason.length > 0, true);

  const currentPatchRemoval = snapshot("same-patch-removal", {
    name: "Same Patch Removal",
    availability: "removed",
    removedInPatch: PATCH,
    dataCoverage: "explicit-removal-with-last-known-values",
  });
  assert.equal(buildPublicPatchItemData([currentPatchRemoval], PATCH), null);

  const repeatedPlan = buildPatchItemSnapshotCorrectionPlan({
    existingSnapshots: [oldAvailable, oldRemoved],
    incomingRows: [incomingAvailable, incomingRemoved],
    corrections: correctionRows,
  });
  assert.equal(repeatedPlan.correctionCount, 0);
});

test("replays correction chains using order-independent hashes for JSONB object keys", () => {
  const baseState = { name: "Item", cost: 100 };
  const base = snapshot("item", baseState);
  const firstState = { name: "Item", availability: "available", cost: 100 };
  const firstHash = canonicalHash(firstState);
  const firstCorrection = {
    patchVersion: PATCH,
    dataset: "items",
    entityKind: "item",
    entitySlug: "item",
    previousContentHash: base.contentHash,
    correctedContentHash: firstHash,
    correctedState: firstState,
    sourceKind: "hub-game",
    sourceUrl: SOURCE_URL,
    sourcePatchVersion: PATCH,
    sourceUpdatedAt: "2026-10-16",
    verificationStatus: "partial",
    sourceEvidence: base.sourceEvidence,
    reason: "fixture correction",
    id: 1,
  };
  const nextState = { cost: 90, availability: "available", name: "Item" };
  const secondCorrection = {
    ...firstCorrection,
    previousContentHash: firstHash,
    correctedContentHash: canonicalHash(nextState),
    correctedState: nextState,
    sourceUpdatedAt: "2026-10-17",
    id: 2,
  };

  const effective = applyPatchItemSnapshotCorrections([base], [firstCorrection, secondCorrection]);
  assert.deepEqual(effective[0].state, nextState);
  assert.equal(effective[0].contentHash, secondCorrection.correctedContentHash);
  assert.throws(() => applyPatchItemSnapshotCorrections([base], [{ ...firstCorrection, previousContentHash: "wrong" }]), /chain does not match/);
  assert.throws(() => applyPatchItemSnapshotCorrections([base], [{ ...firstCorrection, correctedContentHash: "wrong" }]), /hash does not match/);
});

test("rejects corrections from another catalog patch and refuses older catalog evidence", () => {
  const base = snapshot("item", { name: "Item", cost: 100 });
  const candidate = incoming("item", { name: "Item", availability: "available", cost: 90 });

  assert.throws(() => buildPatchItemSnapshotCorrectionPlan({
    existingSnapshots: [base],
    incomingRows: [{ ...candidate, sourceEvidence: [{ role: "item-catalog", sourcePatchVersion: "8.3", sourceUpdatedAt: "2026-10-17" }] }],
  }), /exact Hub current baseline/);

  assert.throws(() => buildPatchItemSnapshotCorrectionPlan({
    existingSnapshots: [snapshot("item", base.state, {
      sourceEvidence: [{ role: "item-catalog", sourcePatchVersion: PATCH, sourceUpdatedAt: "2026-10-18" }],
    })],
    incomingRows: [candidate],
  }), /Refusing an older item source snapshot/);
});

test("does not append a no-op correction when JSONB object key order changes", () => {
  const baseState = { name: "Stable Item", cost: 100, availability: "available" };
  const currentSourceState = incoming("stable-item", { availability: "available", cost: 100, name: "Stable Item" }, {
    sourceUpdatedAt: "2026-10-15",
    sourceEvidence: snapshot("stable-item", baseState).sourceEvidence,
  });
  const plan = buildPatchItemSnapshotCorrectionPlan({
    existingSnapshots: [snapshot("stable-item", baseState)],
    incomingRows: [currentSourceState],
  });

  assert.equal(plan.correctionCount, 0);
  assert.deepEqual(plan.unchangedExisting, ["stable-item"]);
});

test("appends a provenance-only correction when the source evidence becomes more complete", () => {
  const state = { name: "Stable Item", cost: 100, availability: "available" };
  const base = snapshot("stable-item", state);
  const richerEvidence = [
    {
      ...base.sourceEvidence[0],
      sourceBasis: "Effects and values transcribed from the game through patch 8.4",
      snapshotScope: "current-baseline",
      historicalReconstruction: "not-performed",
    },
  ];
  const currentSource = incoming("stable-item", state, {
    sourceUpdatedAt: base.sourceUpdatedAt,
    sourceEvidence: richerEvidence,
  });

  const plan = buildPatchItemSnapshotCorrectionPlan({
    existingSnapshots: [base],
    incomingRows: [currentSource],
  });

  assert.equal(plan.correctionCount, 1);
  assert.equal(plan.corrections[0].previousContentHash, base.contentHash);
  assert.equal(plan.corrections[0].correctedContentHash, canonicalHash(state));
  assert.deepEqual(plan.corrections[0].correctedState, state);
  const effective = applyPatchItemSnapshotCorrections([base], plan.corrections.map((row) => ({ ...row, id: 1 })));
  assert.deepEqual(effective[0].state, state);
  assert.deepEqual(effective[0].sourceEvidence, richerEvidence);

  const repeatedPlan = buildPatchItemSnapshotCorrectionPlan({
    existingSnapshots: [base],
    incomingRows: [currentSource],
    corrections: plan.corrections.map((row) => ({ ...row, id: 1 })),
  });
  assert.equal(repeatedPlan.correctionCount, 0);
  assert.deepEqual(repeatedPlan.unchangedExisting, ["stable-item"]);
});

test("serializes correction records with the snake_case columns expected by jsonb_to_recordset", () => {
  const correction = {
    patchVersion: "8.4",
    dataset: "items",
    entityKind: "item",
    entitySlug: "example-item",
    previousContentHash: "previous-hash",
    correctedContentHash: "corrected-hash",
    correctedState: { name: "Example Item", availability: "available" },
    sourceKind: "hub-game",
    sourceUrl: "https://hub-game.com/wildrift/en/items/example-item",
    sourcePatchVersion: "8.4",
    sourceUpdatedAt: "2026-10-17",
    verificationStatus: "verified",
    sourceEvidence: [{ role: "item-catalog", sourcePatchVersion: "8.4" }],
    reason: "fixture correction",
    correctionHash: "record-hash",
  };
  const expectedColumns = [
    "patch_version", "dataset", "entity_kind", "entity_slug", "corrected_entity_slug", "previous_content_hash",
    "corrected_content_hash", "corrected_state", "source_kind", "source_url",
    "source_patch_version", "source_updated_at", "verification_status", "source_evidence",
    "reason", "correction_hash",
  ];

  const row = mapPatchItemSnapshotCorrectionToDbRow(correction);
  const serialized = JSON.parse(serializePatchItemSnapshotCorrectionsForDb([correction]));

  assert.deepEqual(Object.keys(row), expectedColumns);
  assert.deepEqual(Object.keys(serialized[0]), expectedColumns);
  assert.equal(serialized[0].patch_version, "8.4");
  assert.equal(serialized[0].entity_slug, "example-item");
  assert.equal(serialized[0].corrected_entity_slug, null);
  assert.deepEqual(serialized[0].corrected_state, correction.correctedState);
  assert.equal(Object.hasOwn(serialized[0], "patchVersion"), false);
});
