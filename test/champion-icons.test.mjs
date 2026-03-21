import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicIconPath,
  buildStoredIconFileName,
  detectIconExtension,
} from "../lib/championIcons.mjs";

test("detectIconExtension prefers content-type and normalizes jpeg", () => {
  assert.equal(
    detectIconExtension("https://example.com/foo.unknown", "image/jpeg"),
    ".jpg",
  );
  assert.equal(
    detectIconExtension("https://example.com/foo.webp", ""),
    ".webp",
  );
});

test("buildStoredIconFileName uses slug plus resolved extension", () => {
  assert.equal(
    buildStoredIconFileName("ahri", "https://example.com/path/icon.png"),
    "ahri.png",
  );
  assert.equal(
    buildStoredIconFileName("lux", "https://example.com/path/icon", "image/avif"),
    "lux.avif",
  );
});

test("buildPublicIconPath returns proxied api icon path", () => {
  assert.equal(buildPublicIconPath("teemo.png"), "/wr-api/icons/teemo.png");
});
