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

function withEnv(env, fn) {
  const previous = {
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
    ASSET_PUBLIC_MODE: process.env.ASSET_PUBLIC_MODE,
  };

  Object.assign(process.env, env);

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

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
  assert.equal(
    buildPublicIconPath("ahri", "http://game.gtimg.cn/images/ahri.png"),
    "/wr-api/icons/ahri?src=https%3A%2F%2Fgame.gtimg.cn%2Fimages%2Fahri.png",
  );
  assert.equal(
    buildPublicIconPath("ahri", "//game.gtimg.cn/images/ahri.png"),
    "/wr-api/icons/ahri?src=https%3A%2F%2Fgame.gtimg.cn%2Fimages%2Fahri.png",
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

test("buildPublicIconPath returns direct S3 urls in public asset mode", () => {
  withEnv(
    {
      S3_ENDPOINT: "https://s3.twcstorage.ru",
      S3_BUCKET: "bucket-name",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
      S3_PUBLIC_BASE_URL: "https://s3.twcstorage.ru/bucket-name",
      ASSET_PUBLIC_MODE: "s3",
    },
    () => {
      assert.equal(
        buildPublicIconPath("rammus", "https://game.gtimg.cn/images/lgamem/act/lrlib/img/HeadIcon/H_S_10064.png"),
        "https://s3.twcstorage.ru/bucket-name/icons/rammus.png",
      );
      assert.equal(
        buildPublicIconPath("rammus", "https://game.gtimg.cn/images/lgamem/act/lrlib/img/HeadIcon/H_S_10064.png", process.env, 48),
        "https://s3.twcstorage.ru/bucket-name/icons/rammus-48.webp",
      );
    },
  );
});
