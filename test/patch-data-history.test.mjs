import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPatchDataTransition,
  comparePatchVersions,
  reversePatchDataHistory,
  reversePatchDataTransition,
} from "../lib/patchDataHistory.mjs";

const source = {
  patchVersion: "7.3b",
  locale: "en-us",
  mode: "summoners-rift",
  dataset: "champion-base-stats",
  entityKind: "champion",
  entitySlug: "aatrox",
  propertyPath: "statsAtLevel1.attackDamage",
  valueType: "number",
  before: 60,
  after: 62,
  sourceKind: "riot-patch-notes",
  sourceUrl: "https://example.com/patch/7-3b",
  sourceEvidence: [{ text: "Attack Damage: 60 → 62" }],
  changeType: "buff",
  verificationStatus: "verified",
};

test("patch version ordering handles letter suffixes", () => {
  assert.ok(comparePatchVersions("7.3b", "7.3a") > 0);
  assert.ok(comparePatchVersions("7.3", "7.2z") > 0);
  assert.throws(() => comparePatchVersions("latest", "7.3"), /major\.minor/);
});

test("applies and reverses only exact typed source values without mutating input", () => {
  const original = { statsAtLevel1: { attackDamage: 60, health: 650 } };
  const next = applyPatchDataTransition(original, source);
  assert.equal(next.statsAtLevel1.attackDamage, 62);
  assert.equal(original.statsAtLevel1.attackDamage, 60);
  assert.deepEqual(reversePatchDataTransition(next, source), original);
  assert.throws(() => applyPatchDataTransition({ statsAtLevel1: { attackDamage: 61 } }, source), /expected 60, found 61/);
  assert.throws(() => reversePatchDataTransition(original, source), /expected 62, found 60/);
});

test("refuses to reverse a patch chain with an unaccounted patch", () => {
  assert.throws(() => reversePatchDataHistory(
    { statsAtLevel1: { attackDamage: 62 } },
    [source],
    ["7.3b", "7.3a"],
    ["statsAtLevel1.attackDamage"],
  ), /missing verified change or no-change evidence for: 7\.3a statsAtLevel1\.attackDamage/);
});

test("reverses a complete explicitly supplied chain from newest patch to oldest", () => {
  const later = { ...source, patchVersion: "7.3b", before: 61, after: 62 };
  const earlier = { ...source, patchVersion: "7.3a", before: 60, after: 61 };
  const oldState = reversePatchDataHistory(
    { statsAtLevel1: { attackDamage: 62 } },
    [earlier, later],
    ["7.3a", "7.3b"],
    ["statsAtLevel1.attackDamage"],
  );
  assert.equal(oldState.statsAtLevel1.attackDamage, 60);
});

test("requires per-property no-change evidence for every patch in the chain", () => {
  const current = { ...source, patchVersion: "7.3b", before: 61, after: 62 };
  assert.throws(() => reversePatchDataHistory(
    { statsAtLevel1: { attackDamage: 62, health: 650 } },
    [current],
    ["7.3b"],
    ["statsAtLevel1.attackDamage", "statsAtLevel1.health"],
  ), /missing verified change or no-change evidence for: 7\.3b statsAtLevel1\.health/);
});

test("refuses to mix entities or modes in one historical chain", () => {
  const otherMode = { ...source, mode: "arena" };
  assert.throws(() => reversePatchDataHistory(
    { statsAtLevel1: { attackDamage: 62 } },
    [source, otherMode],
    ["7.3b"],
    ["statsAtLevel1.attackDamage"],
  ), /more than one locale, mode, dataset, or entity/);
});

test("rejects a value type that disagrees with recorded before/after data", () => {
  assert.throws(() => applyPatchDataTransition({}, { ...source, before: "60" }), /values do not match number/);
  assert.throws(() => applyPatchDataTransition({}, { ...source, verificationStatus: "unresolved" }), /Only verified transitions/);
});
