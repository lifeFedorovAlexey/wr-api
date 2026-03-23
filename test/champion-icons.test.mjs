import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIconStorageKey,
  buildIconVariantStorageKey,
  buildPublicIconPath,
  buildStoredIconFileName,
  detectIconExtension,
  normalizeIconSize,
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
  assert.equal(buildPublicIconPath("teemo"), "/wr-api/icons/teemo");
  assert.equal(
    buildPublicIconPath("ahri", "https://example.com/ahri.png"),
    "/wr-api/icons/ahri?src=https%3A%2F%2Fexample.com%2Fahri.png",
  );
});

test("normalizeIconSize snaps requested values to the supported buckets", () => {
  assert.equal(normalizeIconSize(null), null);
  assert.equal(normalizeIconSize("17"), 24);
  assert.equal(normalizeIconSize(24), 24);
  assert.equal(normalizeIconSize(33), 48);
  assert.equal(normalizeIconSize(512), 96);
});

test("icon storage keys stay stable and do not include source urls", () => {
  const sourceUrl = "https://cdn.example.com/path/to/icon.png?foo=bar";

  assert.equal(buildIconStorageKey("ahri", sourceUrl), "icons/ahri.png");
  assert.equal(buildIconVariantStorageKey("ahri", 48), "icons/ahri-48.webp");
  assert.equal(buildIconStorageKey("ahri", sourceUrl).includes("cdn.example.com"), false);
  assert.equal(buildIconVariantStorageKey("ahri", 48).includes("http"), false);
});