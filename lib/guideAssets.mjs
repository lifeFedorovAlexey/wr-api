import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
const GUIDE_ASSET_FETCH_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.GUIDE_ASSET_FETCH_TIMEOUT_MS || 15_000),
);

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

function buildFallbackGuideAssetsDir() {
  return path.resolve(process.cwd(), ".runtime", "guide-assets");
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
  } catch {
    // Fall back to the default extension when the source is not a parseable URL.
  }

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

async function downloadGuideAssetWithTimeout(sourceUrl, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`timeout after ${GUIDE_ASSET_FETCH_TIMEOUT_MS}ms`)),
    GUIDE_ASSET_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(sourceUrl, {
      ...options,
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";
    const buffer = response.ok && response.body
      ? Buffer.from(await response.arrayBuffer())
      : null;

    return {
      response,
      contentType,
      buffer,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveGuideAssetsDirWithFallback(env, options) {
  let assetsDir = resolveGuideAssetsDir(env);

  try {
    await mkdir(assetsDir, { recursive: true });
  } catch (error) {
    if (env.GUIDE_ASSETS_DIR) {
      throw error;
    }

    const fallbackDir = buildFallbackGuideAssetsDir();
    if (typeof options.onFallbackDir === "function") {
      options.onFallbackDir({
        fallbackDir,
        assetsDir,
        error,
      });
    } else {
      console.warn(
        `[guideAssets] fallback assets dir ${fallbackDir} after mkdir failed for ${assetsDir}: ${error?.message || error}`,
      );
    }
    await mkdir(fallbackDir, { recursive: true });
    assetsDir = fallbackDir;
  }

  return assetsDir;
}

function resolveGuideAssetFilePath(assetsDir, entry) {
  if (!entry?.fileName) {
    return null;
  }

  const filePath = path.join(assetsDir, entry.fileName);
  return existsSync(filePath) ? filePath : null;
}

function shouldReuseMirroredGuideAsset(prev, sourceUrl, assetsDir) {
  return Boolean(
    prev?.sourceUrl === sourceUrl &&
    prev?.fileName &&
    resolveGuideAssetFilePath(assetsDir, prev),
  );
}

function createGuideAssetManifestEntry(sourceUrl, fileName, error = null) {
  return {
    sourceUrl,
    fileName,
    lastFailedAt: error ? new Date().toISOString() : null,
    lastError: error ? error?.message || String(error) : null,
  };
}

async function storeMirroredGuideAssetFile({ assetsDir, safeKey, sourceUrl, contentType, buffer, prev }) {
  const fileName = buildStoredGuideAssetFileName(safeKey, sourceUrl, contentType);
  const tempPath = path.join(assetsDir, `${fileName}.tmp`);
  const finalPath = path.join(assetsDir, fileName);

  await writeFile(tempPath, buffer);
  await rename(tempPath, finalPath);

  if (prev?.fileName && prev.fileName !== fileName) {
    await rm(path.join(assetsDir, prev.fileName), { force: true });
  }

  return { fileName, finalPath };
}

async function persistGuideAssetManifest(manifest, manifestPath, safeKey, entry) {
  manifest[safeKey] = entry;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

async function performGuideAssetMirror({
  safeKey,
  sourceUrl,
  env,
  assetsDir,
  manifest,
  manifestPath,
  prev,
  objectStorage,
}) {
  const { response, contentType, buffer } = await downloadGuideAssetWithTimeout(sourceUrl, {
    headers: {
      "user-agent": "wildriftallstats-bot/1.0 (+https://wildriftallstats.ru)",
      accept: "*/*",
    },
  });
  if (!response.ok || !buffer) {
    throw new Error(`HTTP ${response.status}`);
  }

  const { fileName, finalPath } = await storeMirroredGuideAssetFile({
    assetsDir,
    safeKey,
    sourceUrl,
    contentType,
    buffer,
    prev,
  });

  await persistGuideAssetManifest(
    manifest,
    manifestPath,
    safeKey,
    createGuideAssetManifestEntry(sourceUrl, fileName),
  );

  if (objectStorage) {
    const detectedContentType = contentType || detectGuideAssetContentType(finalPath);
    const storageKey = buildGuideAssetStorageKey(safeKey, sourceUrl, detectedContentType);

    if (!(await objectStorage.objectExists(storageKey))) {
      await objectStorage.uploadFile(
        finalPath,
        storageKey,
        detectedContentType,
        "public, max-age=31536000, immutable",
      );
    }
  }

  return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
}

async function finalizeGuideAssetMirrorFailure({
  error,
  options,
  manifest,
  manifestPath,
  safeKey,
  sourceUrl,
  prev,
  env,
}) {
  if (typeof options.onMirrorError === "function") {
    options.onMirrorError({
      assetKey: safeKey,
      sourceUrl,
      error,
    });
  } else {
    console.warn(`[guideAssets] failed to mirror ${safeKey}:`, error?.message || error);
  }

  await persistGuideAssetManifest(
    manifest,
    manifestPath,
    safeKey,
    createGuideAssetManifestEntry(sourceUrl, prev?.fileName || null, error),
  );

  return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
}

export async function createGuideAssetStore(env = process.env, options = {}) {
  const objectStorage = options.objectStorage || createObjectStorageClient(env);
  const assetsDir = await resolveGuideAssetsDirWithFallback(env, options);
  const manifestPath = path.join(assetsDir, "manifest.json");
  const manifest = await loadManifest(manifestPath);

  function getCachedFilePath(assetKey) {
    return resolveGuideAssetFilePath(assetsDir, manifest[assetKey]);
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

  async function ensureObjectStorageMirror(assetKey, sourceUrl, filePath, contentType = "") {
    if (!objectStorage || !filePath) {
      return;
    }

    const detectedContentType = contentType || detectGuideAssetContentType(filePath);
    const storageKey = buildGuideAssetStorageKey(assetKey, sourceUrl, detectedContentType);
    if (await objectStorage.objectExists(storageKey)) {
      return;
    }

    await objectStorage.uploadFile(
      filePath,
      storageKey,
      detectedContentType,
      "public, max-age=31536000, immutable",
    );
  }

  async function mirror(assetKey, sourceUrl) {
    const safeKey = sanitizeAssetKey(assetKey);
    if (!safeKey || !sourceUrl) return null;

    const prev = manifest[safeKey];
    const prevFilePath = resolveGuideAssetFilePath(assetsDir, prev);
    if (shouldReuseMirroredGuideAsset(prev, sourceUrl, assetsDir) && prevFilePath) {
      await ensureObjectStorageMirror(safeKey, sourceUrl, prevFilePath);
      return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
    }

    if (shouldSkipRetry(safeKey, sourceUrl)) {
      return buildPublicGuideAssetPath(safeKey, sourceUrl, env);
    }

    try {
      return await performGuideAssetMirror({
        safeKey,
        sourceUrl,
        env,
        assetsDir,
        manifest,
        manifestPath,
        prev,
        objectStorage,
      });
    } catch (error) {
      return await finalizeGuideAssetMirrorFailure({
        error,
        options,
        manifest,
        manifestPath,
        safeKey,
        sourceUrl,
        prev,
        env,
      });
    }
  }

  return { mirror, assetsDir, getCachedFilePath };
}
