import path from "node:path";

import { buildGuideAssetKey, buildPublicGuideAssetPath } from "./guideAssets.mjs";

function slugifySegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildSkinSlug(championSlug, skinName) {
  const championPart = slugifySegment(championSlug);
  const skinPart = slugifySegment(skinName);
  return [championPart, skinPart].filter(Boolean).join("-");
}

export function buildSkinAssetKey(championSlug, skinName, kind) {
  return buildGuideAssetKey("skin", championSlug, skinName, kind);
}

export function buildPublicSkinAssetPath(championSlug, skinName, kind, sourceUrl = null) {
  return buildPublicGuideAssetPath(
    buildSkinAssetKey(championSlug, skinName, kind),
    sourceUrl,
  );
}

export function normalizeSkinAssetPath(championSlug, skinName, kind, sourceUrl) {
  if (!sourceUrl) return null;
  if (String(sourceUrl).startsWith("/")) return sourceUrl;

  try {
    const url = new URL(sourceUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return buildPublicSkinAssetPath(championSlug, skinName, kind, sourceUrl);
    }
  } catch {}

  return sourceUrl;
}

export function resolveMergedSkinsDir(env = process.env) {
  if (env.SKINS_SOURCE_DIR) {
    return env.SKINS_SOURCE_DIR;
  }

  return path.resolve(process.cwd(), "..", "wildRiftChampions", "ui", "public", "merged");
}

export function toSkinDto(row) {
  const imageUrl = row.imageAssetPath || row.imageSourceUrl || null;
  const modelUrl = row.modelAssetPath || row.modelSourceUrl || null;

  return {
    name: row.skinName,
    image: {
      preview: imageUrl,
      full: imageUrl,
    },
    has3d: row.has3d === true,
    model: modelUrl
      ? {
          cdn: modelUrl,
          local: null,
        }
      : null,
  };
}

export function assembleSkinCollection(collection, rows) {
  const sortedRows = [...rows].sort((left, right) => left.sortOrder - right.sortOrder);
  const skins = sortedRows.map((row) => toSkinDto(row));

  return {
    slug: collection.championSlug,
    skinCount: skins.length,
    with3d: skins.filter((skin) => skin.has3d).length,
    skins,
  };
}
