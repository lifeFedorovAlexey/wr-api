import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const EXT_BY_CONTENT_TYPE = {
  "image/png": ".png",
  "image/webp": ".webp",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/avif": ".avif",
};

export function buildPublicIconPath(fileName) {
  return `/wr-api/icons/${fileName}`;
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
  } catch {}

  return ".png";
}

export function buildStoredIconFileName(slug, sourceUrl, contentType = "") {
  return `${slug}${detectIconExtension(sourceUrl, contentType)}`;
}

async function loadManifest(manifestPath) {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function createChampionIconStore(env = process.env) {
  const iconsDir = resolveIconsDir(env);
  const manifestPath = path.join(iconsDir, "manifest.json");

  await mkdir(iconsDir, { recursive: true });
  const manifest = await loadManifest(manifestPath);

  async function persistManifest() {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  async function mirror(slug, sourceUrl) {
    if (!slug || !sourceUrl) return null;

    const prev = manifest[slug];
    if (
      prev?.sourceUrl === sourceUrl &&
      prev?.fileName &&
      existsSync(path.join(iconsDir, prev.fileName))
    ) {
      return buildPublicIconPath(prev.fileName);
    }

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const fileName = buildStoredIconFileName(slug, sourceUrl, contentType);
      const tempPath = path.join(iconsDir, `${fileName}.tmp`);
      const finalPath = path.join(iconsDir, fileName);

      await pipeline(response.body, createWriteStream(tempPath));
      await rename(tempPath, finalPath);

      if (prev?.fileName && prev.fileName !== fileName) {
        await rm(path.join(iconsDir, prev.fileName), { force: true });
      }

      manifest[slug] = { sourceUrl, fileName };
      await persistManifest();

      return buildPublicIconPath(fileName);
    } catch (error) {
      console.warn(`[championIcons] failed to mirror ${slug}:`, error?.message || error);

      if (prev?.fileName && existsSync(path.join(iconsDir, prev.fileName))) {
        return buildPublicIconPath(prev.fileName);
      }

      return sourceUrl;
    }
  }

  return { mirror, iconsDir };
}
