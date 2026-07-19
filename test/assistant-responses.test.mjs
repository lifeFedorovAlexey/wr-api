import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://localhost:5432/test";

const { buildAssistantResponsePayload } = await import("../api/assistant-responses.js");

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
