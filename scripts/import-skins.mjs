import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { db, client } from "../db/client.js";
import { skinCollections, skinEntries } from "../db/schema.js";
import {
  buildSkinSlug,
  normalizeSkinAssetPath,
  resolveMergedSkinsDir,
} from "../lib/skins.mjs";

function toBoolFlag(value) {
  return value === true;
}

function toChampionDisplayName(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function upsertCollection(championSlug, championName) {
  const existing = await db
    .select()
    .from(skinCollections)
    .where(eq(skinCollections.championSlug, championSlug))
    .limit(1);

  const payload = {
    championSlug,
    championName,
    source: "merged-json",
    sourceUpdatedAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db
      .update(skinCollections)
      .set(payload)
      .where(eq(skinCollections.championSlug, championSlug));
    return;
  }

  await db.insert(skinCollections).values({
    ...payload,
    createdAt: new Date(),
  });
}

async function replaceEntriesForChampion(championSlug, skins) {
  await db.delete(skinEntries).where(eq(skinEntries.championSlug, championSlug));

  if (!skins.length) {
    return 0;
  }

  const now = new Date();
  await db.insert(skinEntries).values(
    skins.map((skin, index) => ({
      championSlug,
      skinSlug: buildSkinSlug(championSlug, skin.name),
      skinName: skin.name,
      sortOrder: index,
      has3d: toBoolFlag(skin.has3d),
      imageSourceUrl: skin.image?.full || null,
      imageAssetPath: normalizeSkinAssetPath(
        championSlug,
        skin.name,
        "image",
        skin.image?.full || null,
      ),
      modelSourceUrl: skin.model?.cdn || null,
      modelAssetPath: normalizeSkinAssetPath(
        championSlug,
        skin.name,
        "model",
        skin.model?.cdn || null,
      ),
      rawPayload: skin,
      sourceUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })),
  );

  return skins.length;
}

async function main() {
  const sourceDir = resolveMergedSkinsDir(process.env);
  const indexPath = path.join(sourceDir, "index.json");
  const slugs = await readJson(indexPath);

  if (!Array.isArray(slugs) || !slugs.length) {
    throw new Error(`No skins index found in ${indexPath}`);
  }

  let championsImported = 0;
  let skinsImported = 0;

  for (const slug of slugs) {
    const filePath = path.join(sourceDir, `${slug}.json`);
    const data = await readJson(filePath);
    const championSlug = String(data.slug || slug).trim();
    const championName = toChampionDisplayName(championSlug);
    const skins = Array.isArray(data.skins) ? data.skins : [];

    await upsertCollection(championSlug, championName);
    skinsImported += await replaceEntriesForChampion(championSlug, skins);
    championsImported += 1;
  }

  console.log(
    JSON.stringify(
      {
        sourceDir,
        championsImported,
        skinsImported,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("[import:skins] error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
