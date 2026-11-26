import test from "node:test";
import assert from "node:assert/strict";

import {
  consumePublicTierlistCreateAttempt,
  resetPublicTierlistCreateRateLimit,
} from "../lib/publicTierlistRateLimit.mjs";

test.afterEach(() => resetPublicTierlistCreateRateLimit());

test("anonymous public tierlist creation is limited per identity", () => {
  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      consumePublicTierlistCreateAttempt("203.0.113.7", { now: 1_000 }).allowed,
      true,
    );
  }

  assert.deepEqual(consumePublicTierlistCreateAttempt("203.0.113.7", { now: 1_000 }), {
    allowed: false,
    retryAfterSeconds: 3600,
  });
  assert.equal(consumePublicTierlistCreateAttempt("203.0.113.8", { now: 1_000 }).allowed, true);
});

test("public tierlist creation allowance resets after the window", () => {
  for (let index = 0; index < 5; index += 1) {
    consumePublicTierlistCreateAttempt("203.0.113.7", { now: 1_000 });
  }

  assert.equal(
    consumePublicTierlistCreateAttempt("203.0.113.7", { now: 3_601_000 }).allowed,
    true,
  );
});
