import assert from "node:assert/strict";
import test from "node:test";
import { shouldSkipPatchReparse } from "../lib/patchParserVersionPolicy.mjs";

test("an older fallback retains successful results from a newer parser even on forced refresh", () => {
  const newer = { parse_status: "parsed", parser_version: 130 };
  for (const flags of [{}, { force: true }, { reparse: true }, { force: true, reparse: true }]) {
    assert.equal(shouldSkipPatchReparse(newer, 109, flags), true);
  }
});

test("the current parser can refresh its own results and upgrade older parses", () => {
  assert.equal(shouldSkipPatchReparse({ parse_status: "parsed", parser_version: 130 }, 130), true);
  assert.equal(shouldSkipPatchReparse({ parse_status: "parsed", parser_version: 130 }, 130, { force: true }), false);
  assert.equal(shouldSkipPatchReparse({ parse_status: "parsed", parser_version: 130 }, 130, { reparse: true }), false);
  assert.equal(shouldSkipPatchReparse({ parse_status: "parsed", parser_version: 129 }, 130), false);
});

test("missing and failed imports remain eligible for recovery", () => {
  assert.equal(shouldSkipPatchReparse(null, 130), false);
  assert.equal(shouldSkipPatchReparse({ parse_status: "failed", parser_version: 130 }, 130), false);
  assert.equal(shouldSkipPatchReparse({ parse_status: "pending", parser_version: 130 }, 130), false);
});
