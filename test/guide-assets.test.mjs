import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

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

test("createGuideAssetStore can surface mirror failures in strict mode", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "wr-guide-assets-"));
  const assetKey = buildGuideAssetKey("guide", "ksante", "passive", "ability");
  const sourceUrl =
    "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/89738e4f1a418a2abe780849077b92e661315aa4-256x256.png?accountingTag=WR";
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };

  try {
    const guideAssetStore = await createGuideAssetStore(
      {
        GUIDE_ASSETS_DIR: assetsDir,
      },
      {
        throwOnMirrorError: true,
      },
    );

    await assert.rejects(
      guideAssetStore.mirror(assetKey, sourceUrl),
      /fetch failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(assetsDir, { recursive: true, force: true });
  }
});

test("createGuideAssetStore recovers an asset file left behind by a failed manifest update", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "wr-guide-assets-"));
  const assetKey = buildGuideAssetKey("patch", "skin", "ryze-movie-director-ryze", "image");
  const sourceUrl =
    "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/896caf3a676f87a8f3d30f09404370460a91593b-1280x720.jpg?accountingTag=WR";
  const finalPath = path.join(assetsDir, `${assetKey}.jpg`);
  const manifestPath = path.join(assetsDir, "manifest.json");
  let fetchCalls = 0;

  await writeFile(finalPath, "cached-image");
  await writeFile(
    manifestPath,
    JSON.stringify({
      [assetKey]: {
        sourceUrl,
        fileName: null,
        lastFailedAt: new Date().toISOString(),
        lastError: "previous manifest update failed",
      },
    }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The existing cached asset should be recovered without fetching");
  };

  try {
    const guideAssetStore = await createGuideAssetStore({ GUIDE_ASSETS_DIR: assetsDir });

    await guideAssetStore.mirror(assetKey, sourceUrl);

    assert.deepEqual(await readFile(finalPath), Buffer.from("cached-image"));
    assert.equal(guideAssetStore.getCachedFilePath(assetKey), finalPath);
    assert.equal(fetchCalls, 0);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest[assetKey].fileName, path.basename(finalPath));
    assert.equal(manifest[assetKey].lastError, null);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(assetsDir, { recursive: true, force: true });
  }
});

test("createGuideAssetStore recovers an orphaned MIME-named file for an extensionless source URL", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "wr-guide-assets-"));
  const assetKey = buildGuideAssetKey("guide", "item", "pickaxe", "image");
  const sourceUrl = "https://assets.example.com/image?id=pickaxe";
  const finalPath = path.join(assetsDir, `${assetKey}.jpg`);
  const manifestPath = path.join(assetsDir, "manifest.json");
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  await writeFile(finalPath, "cached-jpeg");
  await writeFile(manifestPath, JSON.stringify({
    [assetKey]: {
      sourceUrl,
      fileName: null,
      lastFailedAt: new Date().toISOString(),
      lastError: "previous manifest update failed",
    },
  }));
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("The orphaned MIME-named asset should be recovered without fetching");
  };

  try {
    const guideAssetStore = await createGuideAssetStore({ GUIDE_ASSETS_DIR: assetsDir });
    await guideAssetStore.mirror(assetKey, sourceUrl);

    assert.equal(guideAssetStore.getCachedFilePath(assetKey), finalPath);
    assert.deepEqual(await readFile(finalPath), Buffer.from("cached-jpeg"));
    assert.equal(fetchCalls, 0);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest[assetKey].fileName, path.basename(finalPath));
    assert.equal(manifest[assetKey].lastError, null);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(assetsDir, { recursive: true, force: true });
  }
});

test("createGuideAssetStore replaces an existing file when the source URL changes", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "wr-guide-assets-"));
  const assetKey = buildGuideAssetKey("patch", "skin", "ryze-movie-director-ryze", "image");
  const sourceUrl =
    "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/896caf3a676f87a8f3d30f09404370460a91593b-1280x720.jpg?accountingTag=WR&v=2";
  const oldSourceUrl = sourceUrl.replace("&v=2", "");
  const finalPath = path.join(assetsDir, `${assetKey}.jpg`);
  const manifestPath = path.join(assetsDir, "manifest.json");
  const originalFetch = globalThis.fetch;
  const downloadedBytes = Buffer.from("updated-image");

  await writeFile(finalPath, "old-image");
  await writeFile(
    manifestPath,
    JSON.stringify({
      [assetKey]: {
        sourceUrl: oldSourceUrl,
        fileName: path.basename(finalPath),
        lastFailedAt: null,
        lastError: null,
      },
    }),
  );
  globalThis.fetch = async () => new Response(downloadedBytes, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });

  try {
    const guideAssetStore = await createGuideAssetStore({ GUIDE_ASSETS_DIR: assetsDir });
    await guideAssetStore.mirror(assetKey, sourceUrl);

    assert.deepEqual(await readFile(finalPath), downloadedBytes);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest[assetKey].sourceUrl, sourceUrl);
    assert.equal(manifest[assetKey].fileName, path.basename(finalPath));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(assetsDir, { recursive: true, force: true });
  }
});

test("createGuideAssetStore ignores retry cooldown in strict mode", async () => {
  const assetsDir = await mkdtemp(path.join(os.tmpdir(), "wr-guide-assets-"));
  const assetKey = buildGuideAssetKey("guide", "ksante", "passive", "ability");
  const sourceUrl =
    "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/89738e4f1a418a2abe780849077b92e661315aa4-256x256.png?accountingTag=WR";
  const manifestPath = path.join(assetsDir, "manifest.json");
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        [assetKey]: {
          sourceUrl,
          fileName: null,
          lastFailedAt: new Date().toISOString(),
          lastError: "fetch failed",
        },
      },
      null,
      2,
    ),
  );

  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch failed again");
  };

  try {
    const guideAssetStore = await createGuideAssetStore(
      {
        GUIDE_ASSETS_DIR: assetsDir,
      },
      {
        throwOnMirrorError: true,
      },
    );

    await assert.rejects(
      guideAssetStore.mirror(assetKey, sourceUrl),
      /fetch failed again/,
    );
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(assetsDir, { recursive: true, force: true });
  }
});
