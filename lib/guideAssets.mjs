import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import {
  buildObjectStoragePublicUrl,
  buildStorageKey,
  createObjectStorageClient,
  shouldUseS3PublicUrls,
} from "./objectStorage.mjs";

const EXT_BY_CONTENT_TYPE = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "model/gltf-binary": ".glb",
  "application/octet-stream": ".bin",
  "video/mp4": ".mp4",
};
const FAILED_RETRY_COOLDOWN_MS = 1000 * 60 * 60 * 12;

function sanitizeAssetKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildGuideAssetKey(...parts) {
  return parts.map((part) => sanitizeAssetKey(part)).filter(Boolean).join("-");
}

export function buildPublicGuideAssetPath(assetKey, sourceUrl = null, env = process.env) {
  const safeKey = sanitizeAssetKey(assetKey);

  if (shouldUseS3PublicUrls(env) && sourceUrl) {
    return (
      buildObjectStoragePublicUrl(buildGuideAssetStorageKey(safeKey, sourceUrl), env) ||
      `/wr-api/assets/${safeKey}?src=${encodeURIComponent(sourceUrl)}`
    );
  }

  const qs = sourceUrl ? `?src=${encodeURIComponent(sourceUrl)}` : "";
  return `/wr-api/assets/${safeKey}${qs}`;
}

export function resolveGuideAssetsDir(env = process.env) {
  if (env.GUIDE_ASSETS_DIR) {
    return env.GUIDE_ASSETS_DIR;
  }

  if (process.platform === "win32") {
    return path.resolve(process.cwd(), ".runtime", "guide-assets");
  }

  return "/var/lib/wr-api/guide-assets";
}

export function detectGuideAssetExtension(sourceUrl, contentType = "") {
  const normalizedContentType = String(contentType).split(";")[0].trim().toLowerCase();
  if (
    normalizedContentType &&
    normalizedContentType !== "application/octet-stream" &&
    EXT_BY_CONTENT_TYPE[normalizedContentType]
  ) {
    return EXT_BY_CONTENT_TYPE[normalizedContentType];
  }

  try {
    const { pathname } = new URL(sourceUrl);
    const ext = path.extname(pathname).toLowerCase();
    if (
      ext &&
      [".png", ".webp", ".jpg", ".jpeg", ".avif", ".gif", ".glb", ".mp4"].includes(ext)
    ) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {}

  return ".png";
}

export function buildStoredGuideAssetFileName(assetKey, sourceUrl, contentType = "") {
  return `${sanitizeAssetKey(assetKey)}${detectGuideAssetExtension(sourceUrl, contentType)}`;
}

export function buildGuideAssetStorageKey(assetKey, sourceUrl, contentType = "") {
  return buildStorageKey("assets", buildStoredGuideAssetFileName(assetKey, sourceUrl, contentType));
}

export function detectGuideAssetContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".avif") return "image/avif";
  if (ext === ".gif") return "image/gif";
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".bin") return "model/gltf-binary";
  if (ext === ".mp4") return "video/mp4";

  return "image/png";
}

async function loadManifest(manifestPath) {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function createGuideAssetStore(env = process.env) {
  const assetsDir = resolveGuideAssetsDir(env);
  const manifestPath = path.join(assetsDir, "manifest.json");
  const objectStorage = createObjectStorageClient(env);

  await mkdir(assetsDir, { recursive: true });
  const manifest = await loadManifest(manifestPath);

  async function persistManifest() {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  function getCachedFilePath(assetKey) {
    const entry = manifest[assetKey];
    if (!entry?.fileName) return null;

    const filePath = path.join(assetsDir, entry.fileName);
    return existsSync(filePath) ? filePath : null;
  }

  function shouldSkipRetry(assetKey, sourceUrl) {
    const entry = manifest[assetKey];
    if (!entry?.sourceUrl || entry.sourceUrl !== sourceUrl) {
      return false;
    }

    if (!entry?.lastFailedAt) {
      return false;
    }

    const failedAt = Date.parse(entry.lastFailedAt);
    if (!Number.isFinite(failedAt)) {
      return false;
    }

    return Date.now() - failedAt < FAILED_RETRY_COOLDOWN_MS;
  }

  async function mirror(assetKey, sourceUrl) {
    const safeKey = sanitizeAssetKey(assetKey);
    if (!safeKey || !sourceUrl) return null;

    const prev = manifest[safeKey];
    if (
      prev?.sourceUrl === sourceUrl &&
      prev?.fileName &&
      existsSync(path.join(assetsDir, prev.fileName))
    ) {
      return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
    }

    if (shouldSkipRetry(safeKey, sourceUrl)) {
      return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
    }

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const fileName = buildStoredGuideAssetFileName(safeKey, sourceUrl, contentType);
      const tempPath = path.join(assetsDir, `${fileName}.tmp`);
      const finalPath = path.join(assetsDir, fileName);

      await pipeline(response.body, createWriteStream(tempPath));
      await rename(tempPath, finalPath);

      if (prev?.fileName && prev.fileName !== fileName) {
        await rm(path.join(assetsDir, prev.fileName), { force: true });
      }

      manifest[safeKey] = {
        sourceUrl,
        fileName,
        lastFailedAt: null,
        lastError: null,
      };
      await persistManifest();

      if (objectStorage) {
        const storageKey = buildGuideAssetStorageKey(safeKey, sourceUrl, contentType);
        if (!(await objectStorage.objectExists(storageKey))) {
          await objectStorage.uploadFile(
            finalPath,
            storageKey,
            contentType || detectGuideAssetContentType(finalPath),
            "public, max-age=31536000, immutable",
          );
        }
      }

      return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
    } catch (error) {
      console.warn(`[guideAssets] failed to mirror ${safeKey}:`, error?.message || error);

      manifest[safeKey] = {
        sourceUrl,
        fileName: prev?.fileName || null,
        lastFailedAt: new Date().toISOString(),
        lastError: error?.message || String(error),
      };
      await persistManifest();

      if (prev?.fileName && existsSync(path.join(assetsDir, prev.fileName))) {
        return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
      }

      return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
    }
  }

  return { mirror, assetsDir, getCachedFilePath };
}
