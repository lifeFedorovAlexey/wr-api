import test from "node:test";
import assert from "node:assert/strict";
import { requireAcceptedCount } from "./assistant-sync-contract.mjs";

test("accepted count returns the server-confirmed number", () => {
  assert.equal(requireAcceptedCount({ accepted: 2 }, 2), 2);
});

test("accepted count rejects partial or missing server confirmation", () => {
  assert.throws(() => requireAcceptedCount({ accepted: 1 }, 2), /accepted=1 expected=2/);
  assert.throws(() => requireAcceptedCount({}, 2), /accepted=missing expected=2/);
});
