import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicGuideHeroPath,
  buildStoredGuideHeroFileName,
  detectGuideHeroExtension,
} from "../lib/guideHeroMedia.mjs";

test("detectGuideHeroExtension prefers content-type and falls back to url extension", () => {
  assert.equal(
    detectGuideHeroExtension("https://example.com/video.unknown", "video/mp4"),
    ".mp4",
  );
  assert.equal(
    detectGuideHeroExtension("https://example.com/video.webm", ""),
    ".webm",
  );
});

test("buildStoredGuideHeroFileName uses slug plus resolved extension", () => {
  assert.equal(
    buildStoredGuideHeroFileName("lux", "https://example.com/path/hero.mp4"),
    "lux.mp4",
  );
  assert.equal(
    buildStoredGuideHeroFileName("ahri", "https://example.com/path/hero", "video/webm"),
    "ahri.webm",
  );
});

test("buildPublicGuideHeroPath returns proxied api video path", () => {
  assert.equal(buildPublicGuideHeroPath("braum"), "/wr-api/hero-media/braum");
});
