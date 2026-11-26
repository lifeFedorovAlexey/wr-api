import test from "node:test";
import assert from "node:assert/strict";

import { createQuizMediaUpload } from "../lib/quizMedia.mjs";

const actor = { id: 42, roles: ["streamer"] };

function storageStub() {
  return {
    async createPresignedPostUpload(key, contentType, options) {
      return {
        url: "https://upload.example/",
        fields: { key, "Content-Type": contentType, policy: "signed-policy" },
        options,
      };
    },
  };
}

test("quiz media upload returns an S3-first immutable public URL", async () => {
  const result = await createQuizMediaUpload(
    actor,
    { contentType: "image/png", size: 1024 },
    {
      storage: storageStub(),
      env: { S3_PUBLIC_BASE_URL: "https://cdn.example/bucket" },
      id: "asset-id",
    },
  );

  assert.equal(result.key, "assets/quizzes/42/asset-id.png");
  assert.equal(
    result.url,
    "https://cdn.example/bucket/assets/quizzes/42/asset-id.png",
  );
  assert.match(result.uploadUrl, /^https:\/\/upload\.example\//);
  assert.equal(result.uploadFields.key, "assets/quizzes/42/asset-id.png");
  assert.equal(result.maxBytes, 5 * 1024 * 1024);
});

test("quiz media upload rejects unsupported types and oversized files", async () => {
  await assert.rejects(
    () =>
      createQuizMediaUpload(
        actor,
        { contentType: "image/svg+xml", size: 100 },
        { storage: storageStub() },
      ),
    (error) =>
      error.message === "unsupported_image_type" && error.statusCode === 415,
  );
  await assert.rejects(
    () =>
      createQuizMediaUpload(
        actor,
        { contentType: "image/png", size: 6 * 1024 * 1024 },
        { storage: storageStub() },
      ),
    (error) => error.message === "image_too_large" && error.statusCode === 413,
  );
});

test("quiz media upload fails closed when object storage is unavailable", async () => {
  await assert.rejects(
    () =>
      createQuizMediaUpload(
        actor,
        { contentType: "image/webp", size: 100 },
        { storage: null },
      ),
    (error) =>
      error.message === "quiz_media_storage_unavailable" &&
      error.statusCode === 503,
  );
});
