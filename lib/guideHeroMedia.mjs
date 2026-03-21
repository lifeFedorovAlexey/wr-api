import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const EXT_BY_CONTENT_TYPE = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/ogg": ".ogv",
};

export function buildPublicGuideHeroPath(slug) {
  return `/wr-api/hero-media/${slug}`;
}

export function resolveGuideHeroMediaDir(env = process.env) {
  if (env.GUIDE_HERO_MEDIA_DIR) {
    return env.GUIDE_HERO_MEDIA_DIR;
  }

  if (process.platform === "win32") {
    return path.resolve(process.cwd(), ".runtime", "guide-hero-media");
  }

  return "/var/lib/wr-api/guide-hero-media";
}

export function detectGuideHeroExtension(sourceUrl, contentType = "") {
  const normalizedContentType = String(contentType).split(";")[0].trim().toLowerCase();
  if (EXT_BY_CONTENT_TYPE[normalizedContentType]) {
    return EXT_BY_CONTENT_TYPE[normalizedContentType];
  }

  try {
    const { pathname } = new URL(sourceUrl);
    const ext = path.extname(pathname).toLowerCase();
    if (ext && [".mp4", ".webm", ".ogv"].includes(ext)) {
      return ext;
    }
  } catch {}

  return ".mp4";
}

export function buildStoredGuideHeroFileName(slug, sourceUrl, contentType = "") {
  return `${slug}${detectGuideHeroExtension(sourceUrl, contentType)}`;
}

async function loadManifest(manifestPath) {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function createGuideHeroMediaStore(env = process.env) {
  const mediaDir = resolveGuideHeroMediaDir(env);
  const manifestPath = path.join(mediaDir, "manifest.json");

  await mkdir(mediaDir, { recursive: true });
  const manifest = await loadManifest(manifestPath);

  async function persistManifest() {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  function getCachedFilePath(slug) {
    const entry = manifest[slug];
    if (!entry?.fileName) return null;

    const filePath = path.join(mediaDir, entry.fileName);
    return existsSync(filePath) ? filePath : null;
  }

  async function mirror(slug, sourceUrl) {
    if (!slug || !sourceUrl) return null;

    const prev = manifest[slug];
    if (
      prev?.sourceUrl === sourceUrl &&
      prev?.fileName &&
      existsSync(path.join(mediaDir, prev.fileName))
    ) {
      return buildPublicGuideHeroPath(slug);
    }

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const fileName = buildStoredGuideHeroFileName(slug, sourceUrl, contentType);
      const tempPath = path.join(mediaDir, `${fileName}.tmp`);
      const finalPath = path.join(mediaDir, fileName);

      await pipeline(response.body, createWriteStream(tempPath));
      await rename(tempPath, finalPath);

      if (prev?.fileName && prev.fileName !== fileName) {
        await rm(path.join(mediaDir, prev.fileName), { force: true });
      }

      manifest[slug] = { sourceUrl, fileName };
      await persistManifest();

      return buildPublicGuideHeroPath(slug);
    } catch (error) {
      console.warn(`[guideHeroMedia] failed to mirror ${slug}:`, error?.message || error);

      if (prev?.fileName && existsSync(path.join(mediaDir, prev.fileName))) {
        return buildPublicGuideHeroPath(slug);
      }

      return null;
    }
  }

  return { mirror, mediaDir, getCachedFilePath };
}
