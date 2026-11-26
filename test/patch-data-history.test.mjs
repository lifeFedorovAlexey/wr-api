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

test("adds and removes explicitly absent values reversibly for every JSON value type", () => {
  for (const [type, value] of [
    ["number", 62], ["string", "active"], ["boolean", false],
    ["object", { damage: 62 }], ["array", [10, 20]],
  ]) {
    const absent = { statsAtLevel1: { attackDamage: null } };
    const present = { statsAtLevel1: { attackDamage: value } };
    const added = { ...source, valueType: type, before: null, after: value, changeType: "new" };
    const removed = { ...source, valueType: type, before: value, after: null, changeType: "removed" };
    assert.deepEqual(applyPatchDataTransition(absent, added), present);
    assert.deepEqual(reversePatchDataTransition(present, added), absent);
    assert.deepEqual(applyPatchDataTransition(present, removed), absent);
    assert.deepEqual(reversePatchDataTransition(absent, removed), present);
    assert.deepEqual(absent, { statsAtLevel1: { attackDamage: null } });
  }
});

test("unchanged evidence closes a history gap, including absent properties and unordered JSON object keys", () => {
  const added = { ...source, patchVersion: "7.3", before: null, after: 60, changeType: "new" };
  const unchanged = { ...source, patchVersion: "7.3a", before: 60, after: 60, changeType: "unchanged" };
  const removed = { ...source, patchVersion: "7.3b", before: 60, after: null, changeType: "removed" };
  const absent = { statsAtLevel1: { attackDamage: null } };
  assert.deepEqual(reversePatchDataHistory(absent, [added, unchanged, removed],
    ["7.3", "7.3a", "7.3b"], [source.propertyPath]), absent);
  assert.deepEqual(applyPatchDataTransition(absent, {
    ...source, valueType: "null", before: null, after: null, changeType: "unchanged",
  }), absent);
  const objectState = { statsAtLevel1: { attackDamage: { a: 1, b: 2 } } };
  assert.deepEqual(applyPatchDataTransition(objectState, {
    ...source, valueType: "object", before: { b: 2, a: 1 }, after: { a: 1, b: 2 }, changeType: "unchanged",
  }), objectState);
});

test("rejects contradictory new, removed, and unchanged evidence instead of inventing absent fields", () => {
  const absent = { statsAtLevel1: { attackDamage: null } };
  for (const transition of [
    { ...source, before: 60, after: 62, changeType: "new" },
    { ...source, before: null, after: null, changeType: "new", valueType: "null" },
    { ...source, before: null, after: "62", changeType: "new" },
    { ...source, before: 60, after: 62, changeType: "removed" },
    { ...source, before: null, after: null, changeType: "removed", valueType: "null" },
    { ...source, before: "60", after: null, changeType: "removed" },
    { ...source, before: 60, after: 62, changeType: "unchanged" },
    { ...source, before: 60, after: null, changeType: "adjustment" },
  ]) assert.throws(() => applyPatchDataTransition(absent, transition), /transitions require|values do not match/i);
  assert.throws(() => applyPatchDataTransition({ statsAtLevel1: {} }, {
    ...source, before: null, changeType: "new",
  }), /Snapshot does not contain property/);
  assert.throws(() => reversePatchDataHistory(absent, [
    { ...source, before: 60, after: null, changeType: "removed" },
  ], ["7.3a", "7.3b"], [source.propertyPath]), /missing verified change or no-change evidence/);
});
