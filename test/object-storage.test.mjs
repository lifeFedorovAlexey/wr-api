import test from "node:test";
import assert from "node:assert/strict";

import {
  buildObjectStoragePublicUrl,
  shouldUseS3PublicUrls,
} from "../lib/objectStorage.mjs";

test("shouldUseS3PublicUrls only needs public mode and public base url", () => {
  assert.equal(
    shouldUseS3PublicUrls({
      ASSET_PUBLIC_MODE: "s3",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/bucket",
    }),
    true,
  );
  assert.equal(
    shouldUseS3PublicUrls({
      ASSET_PUBLIC_MODE: "local",
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/bucket",
    }),
    false,
  );
  assert.equal(
    shouldUseS3PublicUrls({
      ASSET_PUBLIC_MODE: "s3",
    }),
    false,
  );
});

test("buildObjectStoragePublicUrl joins the public base url with the storage key", () => {
  assert.equal(
    buildObjectStoragePublicUrl("icons/rammus-48.webp", {
      S3_PUBLIC_BASE_URL: "https://cdn.example.com/bucket/",
    }),
    "https://cdn.example.com/bucket/icons/rammus-48.webp",
  );
});
