import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import sharp from "sharp";

import {
  buildObjectStoragePublicUrl,
  buildStorageKey,
  createObjectStorageClient,
  shouldUseS3PublicUrls,
} from "./objectStorage.mjs";
import { normalizeRemoteAssetUrl } from "./remoteAssetPolicy.mjs";

const EXT_BY_CONTENT_TYPE = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/avif": ".avif",
};

export const ICON_DERIVATIVE_SIZES = [24, 32, 48, 72, 96];

export function normalizeIconSize(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  const allowed = ICON_DERIVATIVE_SIZES.find((size) => size >= parsed);
  return allowed || ICON_DERIVATIVE_SIZES[ICON_DERIVATIVE_SIZES.length - 1];
}

function buildLocalIconPath(slug, sourceUrl = null, size = null) {
  const params = new URLSearchParams();
  const normalizedSourceUrl = normalizeRemoteAssetUrl(sourceUrl);
  if (normalizedSourceUrl) params.set("src", normalizedSourceUrl);
  if (size) params.set("size", String(size));
  const qs = params.toString();
  return `/wr-api/icons/${slug}${qs ? `?${qs}` : ""}`;
}

export function buildPublicIconPath(slug, sourceUrl = null, env = process.env, size = null) {
  const normalizedSize = normalizeIconSize(size);
  const normalizedSourceUrl = normalizeRemoteAssetUrl(sourceUrl);

  if (shouldUseS3PublicUrls(env) && normalizedSourceUrl) {
    const storageKey = normalizedSize
      ? buildIconVariantStorageKey(slug, normalizedSize)
      : buildIconStorageKey(slug, normalizedSourceUrl);

    return buildObjectStoragePublicUrl(storageKey, env) || buildLocalIconPath(slug, normalizedSourceUrl, normalizedSize);
  }

  return buildLocalIconPath(slug, normalizedSourceUrl, normalizedSize);
}

export function resolveIconsDir(env = process.env) {
  if (env.CHAMPION_ICONS_DIR) {
    return env.CHAMPION_ICONS_DIR;
  }

  if (process.platform === "win32") {
    return path.resolve(process.cwd(), ".runtime", "champion-icons");
  }

  return "/var/lib/wr-api/champion-icons";
}

export function detectIconExtension(sourceUrl, contentType = "") {
  const normalizedContentType = String(contentType).split(";")[0].trim().toLowerCase();
  if (EXT_BY_CONTENT_TYPE[normalizedContentType]) {
    return EXT_BY_CONTENT_TYPE[normalizedContentType];
  }

  try {
    const { pathname } = new URL(sourceUrl);
    const ext = path.extname(pathname).toLowerCase();
    if (ext && [".png", ".webp", ".jpg", ".jpeg", ".avif"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {
    // Fall back to the default extension when the source is not a parseable URL.
  }

  return ".png";
}

export function buildStoredIconFileName(slug, sourceUrl, contentType = "") {
  return `${slug}${detectIconExtension(sourceUrl, contentType)}`;
}

export function buildStoredIconVariantFileName(slug, size) {
  return `${slug}-${size}.webp`;
}

export function buildIconStorageKey(slug, sourceUrl, contentType = "") {
  return buildStorageKey("icons", buildStoredIconFileName(slug, sourceUrl, contentType));
}

export function buildIconVariantStorageKey(slug, size) {
  return buildStorageKey("icons", buildStoredIconVariantFileName(slug, size));
}

async function loadManifest(manifestPath) {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveIconFilePath(iconsDir, entry) {
  if (!entry?.fileName) {
    return null;
  }

  const filePath = path.join(iconsDir, entry.fileName);
  return existsSync(filePath) ? filePath : null;
}

function shouldReuseMirroredIcon(prev, sourceUrl, iconsDir) {
  return Boolean(
    prev?.sourceUrl === sourceUrl &&
    prev?.fileName &&
    resolveIconFilePath(iconsDir, prev),
  );
}

async function uploadIconIfNeeded(objectStorage, finalPath, slug, sourceUrl, contentType = "") {
  if (!objectStorage) {
    return;
  }

  await objectStorage.uploadFile(
    finalPath,
    buildIconStorageKey(slug, sourceUrl, contentType),
    contentType || undefined,
    "public, max-age=31536000, immutable",
  );
}

async function clearIconVariants(iconsDir, slug) {
  for (const size of ICON_DERIVATIVE_SIZES) {
    await rm(path.join(iconsDir, buildStoredIconVariantFileName(slug, size)), { force: true });
  }
}

async function persistMirroredIcon({
  response,
  slug,
  sourceUrl,
  prev,
  manifest,
  iconsDir,
}) {
  const contentType = response.headers.get("content-type") || "";
  const fileName = buildStoredIconFileName(slug, sourceUrl, contentType);
  const tempPath = path.join(iconsDir, `${fileName}.tmp`);
  const finalPath = path.join(iconsDir, fileName);

  await pipeline(response.body, createWriteStream(tempPath));
  await rename(tempPath, finalPath);

  if (prev?.fileName && prev.fileName !== fileName) {
    await rm(path.join(iconsDir, prev.fileName), { force: true });
  }

  await clearIconVariants(iconsDir, slug);

  manifest[slug] = { sourceUrl, fileName };
  return { contentType, finalPath };
}

export async function createChampionIconStore(env = process.env) {
  const iconsDir = resolveIconsDir(env);
  const manifestPath = path.join(iconsDir, "manifest.json");
  const objectStorage = createObjectStorageClient(env);

  await mkdir(iconsDir, { recursive: true });
  const manifest = await loadManifest(manifestPath);

  async function persistManifest() {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  function getCachedFilePath(slug) {
    const entry = manifest[slug];
    if (!entry?.fileName) return null;

    const filePath = path.join(iconsDir, entry.fileName);
    return existsSync(filePath) ? filePath : null;
  }

  function getCachedVariantFilePath(slug, size) {
    const normalizedSize = normalizeIconSize(size);
    if (!normalizedSize) return null;

    const filePath = path.join(iconsDir, buildStoredIconVariantFileName(slug, normalizedSize));
    return existsSync(filePath) ? filePath : null;
  }

  async function ensureVariant(slug, size) {
    const normalizedSize = normalizeIconSize(size);
    if (!normalizedSize) return null;

    const existing = getCachedVariantFilePath(slug, normalizedSize);
    if (existing) return existing;

    const originalPath = getCachedFilePath(slug);
    if (!originalPath) return null;

    const fileName = buildStoredIconVariantFileName(slug, normalizedSize);
    const tempPath = path.join(iconsDir, `${fileName}.tmp`);
    const finalPath = path.join(iconsDir, fileName);

    await sharp(originalPath)
      .resize(normalizedSize, normalizedSize, { fit: "cover" })
      .webp({ quality: 82 })
      .toFile(tempPath);

    await rename(tempPath, finalPath);

    if (objectStorage) {
      await objectStorage.uploadFile(
        finalPath,
        buildIconVariantStorageKey(slug, normalizedSize),
        "image/webp",
        "public, max-age=31536000, immutable",
      );
    }

    return finalPath;
  }

  async function mirror(slug, sourceUrl) {
    if (!slug || !sourceUrl) return null;

    const prev = manifest[slug];
    if (shouldReuseMirroredIcon(prev, sourceUrl, iconsDir)) {
      return buildPublicIconPath(slug, sourceUrl, env);
    }

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const { contentType, finalPath } = await persistMirroredIcon({
        response,
        slug,
        sourceUrl,
        prev,
        manifest,
        iconsDir,
      });
      await persistManifest();
      await uploadIconIfNeeded(objectStorage, finalPath, slug, sourceUrl, contentType);

      return buildPublicIconPath(slug, sourceUrl, env);
    } catch (error) {
      console.warn(`[championIcons] failed to mirror ${slug}:`, error?.message || error);

      if (resolveIconFilePath(iconsDir, prev)) {
        return buildPublicIconPath(slug, sourceUrl, env);
      }

      return buildPublicIconPath(slug, sourceUrl, env);
    }
  }

  return { mirror, iconsDir, getCachedFilePath, getCachedVariantFilePath, ensureVariant };
}
