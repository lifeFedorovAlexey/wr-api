import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://localhost:5432/test";

const {
  buildAssistantResponsePayload,
  getSyncLoreMismatch,
  getSyncSnapshotMismatch,
  normalizeAssistantResponseForSync,
} = await import("../api/assistant-responses.js");

test("daily assistant response remains available after an hourly stats snapshot", () => {
  const row = {
    championSlug: "shen",
    lane: "top",
    rank: "masterPlus",
    response: "Prepared daily response",
    statsSnapshotId: 1228,
  };

  assert.deepEqual(buildAssistantResponsePayload(row, { id: 1229 }), {
    ...row,
    isStale: true,
    latestStatsSnapshotId: 1229,
  });
});

test("assistant response reports matching snapshot as current", () => {
  const row = { response: "Prepared daily response", statsSnapshotId: 1229 };

  assert.deepEqual(buildAssistantResponsePayload(row, { id: 1229 }), {
    ...row,
    isStale: false,
    latestStatsSnapshotId: 1229,
  });
});

test("sync mapping emits only the assistant_responses columns", () => {
  assert.deepEqual(normalizeAssistantResponseForSync({
    championSlug: "aatrox",
    lane: "top",
    rank: "diamondPlus",
    tipIndex: 2,
    response: "Prepared response",
    requestedModel: "gpt-oss:20b",
    actualModel: "gpt-oss:20b",
  }, { statsSnapshotId: 1234, loreContentHash: "lore-hash" }), {
    championSlug: "aatrox",
    lane: "top",
    rank: "diamondPlus",
    response: "Prepared response",
    statsSnapshotId: 1234,
    loreContentHash: "lore-hash",
    model: "gpt-oss:20b",
  });
});

test("sync accepts a completed older snapshot but rejects an unknown snapshot", () => {
  assert.deepEqual(getSyncSnapshotMismatch([
    { statsSnapshotId: 1228 },
  ], 1229), {
    expected: 1229,
    received: [1228],
  });
  assert.equal(getSyncSnapshotMismatch([
    { statsSnapshotId: 1229 },
  ], 1229), null);
  assert.equal(getSyncSnapshotMismatch([
    { statsSnapshotId: 1228 },
  ], 1229, [1228]), null);
  assert.deepEqual(getSyncSnapshotMismatch([
    { statsSnapshotId: 1227 },
  ], 1229, [1228]), {
    expected: 1229,
    received: [1227],
  });
});

test("sync rejects a package generated from stale champion lore", () => {
  const loreMap = new Map([["aatrox", "current-hash"]]);
  assert.deepEqual(getSyncLoreMismatch([
    { championSlug: "aatrox", loreContentHash: "old-hash" },
  ], loreMap), [{
    championSlug: "aatrox",
    expected: "current-hash",
    received: "old-hash",
  }]);
  assert.equal(getSyncLoreMismatch([
    { championSlug: "aatrox", loreContentHash: "current-hash" },
  ], loreMap), null);
});
