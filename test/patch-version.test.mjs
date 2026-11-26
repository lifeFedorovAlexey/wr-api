import assert from "node:assert/strict";
import test from "node:test";
import {
  comparePatchVersions,
  isValidPatchVersion,
  matchPatchVersionPrefix,
  parsePatchVersion,
  requirePatchVersion,
} from "../lib/patchVersion.mjs";

test("parses existing Wild Rift patch formats and multi-letter suffixes", () => {
  for (const version of ["6.2k", "7.3", "7.3b", "7.3ab", " 7.3AB "]) {
    assert.equal(isValidPatchVersion(version), true, version);
  }
  assert.equal(parsePatchVersion("7.3AB").value, "7.3ab");
  assert.equal(isValidPatchVersion("0.0-beta"), true);
  assert.equal(parsePatchVersion("0.0-BETA").value, "0.0-beta");
  assert.equal(requirePatchVersion("7.3ab"), "7.3ab");
  for (const version of ["7", "7.3.1", "7.3-rc", "", null]) {
    assert.equal(isValidPatchVersion(version), false, String(version));
  }
});

test("orders patch versions by numeric version then the complete suffix", () => {
  const versions = ["7.3b", "7.3ab", "7.3a", "7.3", "7.2z"];
  assert.deepEqual(versions.sort(comparePatchVersions), ["7.2z", "7.3", "7.3a", "7.3ab", "7.3b"]);
  assert.ok(comparePatchVersions("0.0-beta", "0.5") < 0);
});

test("extracts a complete patch suffix before whitespace or prose", () => {
  assert.equal(matchPatchVersionPrefix("7.3ab Removed in game").matchedText, "7.3ab");
  assert.equal(matchPatchVersionPrefix("7.3ab.").matchedText, "7.3ab");
  assert.equal(matchPatchVersionPrefix("7.3b").value, "7.3b");
  assert.equal(matchPatchVersionPrefix("7.3AB Removed in game").matchedText, "7.3AB");
  assert.equal(matchPatchVersionPrefix("7.3Surging Scales").matchedText, "7.3");
  assert.equal(matchPatchVersionPrefix("7.3bBattle item").matchedText, "7.3b");
  assert.equal(matchPatchVersionPrefix("0.0-BETA balance changes").value, "0.0-beta");
  assert.equal(matchPatchVersionPrefix("7.3.1 Removed"), null);
  assert.equal(matchPatchVersionPrefix("0.0-beta balance changes").value, "0.0-beta");
});
