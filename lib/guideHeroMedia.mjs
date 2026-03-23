import { existsSync } from "node:fs";
import path from "node:path";

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

export function buildGuideHeroMediaFileName(slug) {
  return `${sanitizeSlug(slug)}.mp4`;
}

export function buildPublicGuideHeroMediaPath(slug) {
  return `/wr-api/hero-media/${buildGuideHeroMediaFileName(slug)}`;
}

export function resolveGuideHeroMediaFilePath(slug, env = process.env) {
  const dir = resolveGuideHeroMediaDir(env);
  const filePath = path.join(dir, buildGuideHeroMediaFileName(slug));
  return existsSync(filePath) ? filePath : null;
}
