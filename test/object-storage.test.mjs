import test from "node:test";
import assert from "node:assert/strict";

import {
  buildObjectStoragePublicUrl,
  createObjectStorageClient,
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

test("presigned POST policy enforces the actual upload size", async () => {
  const storage = createObjectStorageClient({
    S3_ENDPOINT: "https://s3.example.com",
    S3_BUCKET: "bucket",
    S3_ACCESS_KEY_ID: "test-key",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_REGION: "ru-1",
  });
  const post = await storage.createPresignedPostUpload(
    "assets/quizzes/1/image.png",
    "image/png",
    { minBytes: 1, maxBytes: 5_242_880, expiresIn: 300 },
  );
  const policy = JSON.parse(
    Buffer.from(post.fields.Policy || post.fields.policy, "base64").toString(
      "utf8",
    ),
  );
  assert.ok(
    policy.conditions.some(
      (condition) =>
        Array.isArray(condition) &&
        condition[0] === "content-length-range" &&
        condition[1] === 1 &&
        condition[2] === 5_242_880,
    ),
  );
});
