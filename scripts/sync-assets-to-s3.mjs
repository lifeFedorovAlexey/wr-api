import "dotenv/config";

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  buildIconStorageKey,
  buildIconVariantStorageKey,
  createChampionIconStore,
  ICON_DERIVATIVE_SIZES,
  resolveIconsDir,
} from "../lib/championIcons.mjs";
import { detectGuideAssetContentType, resolveGuideAssetsDir } from "../lib/guideAssets.mjs";
import { resolveGuideHeroMediaDir } from "../lib/guideHeroMedia.mjs";
import { buildStorageKey, createObjectStorageClient } from "../lib/objectStorage.mjs";

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function loadJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function detectIconContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".avif") return "image/avif";
  return "image/png";
}

async function main() {
  const objectStorage = createObjectStorageClient(process.env);
  if (!objectStorage) {
    throw new Error("S3 env is not configured");
  }

  const iconsDir = resolveIconsDir(process.env);
  const assetsDir = resolveGuideAssetsDir(process.env);
  const heroDir = resolveGuideHeroMediaDir(process.env);
  const iconStore = await createChampionIconStore(process.env);
  const iconManifest = await loadJson(path.join(iconsDir, "manifest.json"));

  let uploaded = 0;
  let skipped = 0;

  for (const [slug, entry] of Object.entries(iconManifest)) {
    if (!entry?.fileName) continue;

    const originalPath = path.join(iconsDir, entry.fileName);
    if (await fileExists(originalPath)) {
      const key = buildIconStorageKey(slug, entry.sourceUrl, detectIconContentType(entry.fileName));
      if (await objectStorage.objectExists(key)) {
        skipped += 1;
      } else {
        await objectStorage.uploadFile(
          originalPath,
          key,
          detectIconContentType(entry.fileName),
          "public, max-age=31536000, immutable",
        );
        uploaded += 1;
      }
    }

    for (const size of ICON_DERIVATIVE_SIZES) {
      const variantPath = await iconStore.ensureVariant(slug, size);
      if (!variantPath) continue;

      const key = buildIconVariantStorageKey(slug, size);
      if (await objectStorage.objectExists(key)) {
        skipped += 1;
      } else {
        await objectStorage.uploadFile(
          variantPath,
          key,
          "image/webp",
          "public, max-age=31536000, immutable",
        );
        uploaded += 1;
      }
    }
  }

  for (const fileName of await listFiles(assetsDir)) {
    if (fileName === "manifest.json") continue;
    const key = buildStorageKey("assets", fileName);
    if (await objectStorage.objectExists(key)) {
      skipped += 1;
    } else {
      await objectStorage.uploadFile(
        path.join(assetsDir, fileName),
        key,
        detectGuideAssetContentType(fileName),
        "public, max-age=31536000, immutable",
      );
      uploaded += 1;
    }
  }

  for (const fileName of await listFiles(heroDir)) {
    const key = buildStorageKey("hero-media", fileName);
    if (await objectStorage.objectExists(key)) {
      skipped += 1;
    } else {
      await objectStorage.uploadFile(
        path.join(heroDir, fileName),
        key,
        "video/mp4",
        "public, max-age=31536000, immutable",
      );
      uploaded += 1;
    }
  }

  console.log(JSON.stringify({ uploaded, skipped }, null, 2));
}

main().catch((error) => {
  console.error("[sync-assets-to-s3] error:", error);
  process.exit(1);
});
