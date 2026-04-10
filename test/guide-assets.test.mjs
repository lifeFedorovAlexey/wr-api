import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  buildGuideAssetKey,
  buildGuideAssetStorageKey,
  createGuideAssetStore,
} from "../lib/guideAssets.mjs";

test("createGuideAssetStore uploads cached assets to S3 when the object is missing", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "wr-guide-assets-"));

  try {
    const assetKey = buildGuideAssetKey("guide", "item", "control-ward", "image");
    const sourceUrl = "https://assets.riftgg.app/items/control-ward.webp";
    const fileName = "guide-item-control-ward-image.webp";
    const filePath = path.join(assetsDir, fileName);
    const manifestPath = path.join(assetsDir, "manifest.json");
    const uploadCalls = [];

    await writeFile(filePath, "fake-image");
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          [assetKey]: {
            sourceUrl,
            fileName,
            lastFailedAt: null,
            lastError: null,
          },
        },
        null,
        2,
      ),
    );

    const guideAssetStore = await createGuideAssetStore(
      {
        GUIDE_ASSETS_DIR: assetsDir,
        ASSET_PUBLIC_MODE: "s3",
        S3_PUBLIC_BASE_URL: "https://cdn.example.com/bucket",
      },
      {
        objectStorage: {
          async objectExists() {
            return false;
          },
          async uploadFile(localPath, key, contentType, cacheControl) {
            uploadCalls.push({ localPath, key, contentType, cacheControl });
            return `https://cdn.example.com/bucket/${key}`;
          },
        },
      },
    );

    const publicUrl = await guideAssetStore.mirror(assetKey, sourceUrl);

    assert.equal(
      publicUrl,
      "https://cdn.example.com/bucket/assets/guide-item-control-ward-image.webp",
    );
    assert.deepEqual(uploadCalls, [
      {
        localPath: filePath,
        key: buildGuideAssetStorageKey(assetKey, sourceUrl, "image/webp"),
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable",
      },
    ]);
  } finally {
    await rm(assetsDir, { recursive: true, force: true });
  }
});
