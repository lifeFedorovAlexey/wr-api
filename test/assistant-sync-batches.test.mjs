import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAssistantSyncBatches,
  DEFAULT_SYNC_BATCH_BYTES,
} from "../lib/assistant-sync-batches.mjs";

test("assistant sync batches preserve order and stay below the byte limit", () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: index,
    response: "x".repeat(30),
  }));
  const batches = buildAssistantSyncBatches(items, 180);

  assert.ok(batches.length > 1);
  assert.deepEqual(batches.flat(), items);
  for (const batch of batches) {
    assert.ok(Buffer.byteLength(JSON.stringify({ items: batch })) <= 180);
  }
});

test("assistant sync rejects one item larger than the request budget", () => {
  assert.throws(
    () => buildAssistantSyncBatches([{ response: "x".repeat(200) }], 100),
    /assistant sync item exceeds 100 bytes/,
  );
});

test("assistant sync uses a conservative default request budget", () => {
  assert.equal(DEFAULT_SYNC_BATCH_BYTES, 192 * 1024);
});
