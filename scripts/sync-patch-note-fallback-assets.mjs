import "dotenv/config";

import * as dbSchema from "../db/schema.js";
import { client, db } from "../db/client.js";
import {
  buildGuideAssetKey,
  buildGuideAssetStorageKey,
  createGuideAssetStore,
} from "../lib/guideAssets.mjs";
import { loadPatchChangeCatalog } from "../lib/patchNotesChangeRecords.mjs";
import { createObjectStorageClient } from "../lib/objectStorage.mjs";

const FALLBACK_ITEM_SLUGS = [
  "pickaxe",
  "hearthbound-axe",
  "at-wits-end",
  "bandleglass-mirror",
  "shurelyas-battlesong",
  "immortal-treads",
  "crimson-lucidity",
  "armorcrusher-boots",
  "gunmetal-greaves",
  "spellslingers-shoes",
  "armored-advance",
  "chainlaced-crushers",
  "verdant-barrier",
  "fated-ashes",
  "void-amethyst",
  "mikaels-blessing",
  "bloodletters-curse",
  "blackfire-torch",
  "stormsurge",
  "dusk-and-dawn",
  "cryptbloom",
  "diadem-of-songs",
  "whispering-circlet",
  "echoes-of-helia",
];
const FALLBACK_RUNE_SLUGS = [
  "relentless-hunter",
  "legend-haste",
  "item-crafting",
  "futures-market",
];

function getMirrorApiOrigin() {
  const option = process.argv.find((argument) => argument.startsWith("--mirror-api-origin="));
  return option?.slice("--mirror-api-origin=".length).trim().replace(/\/+$/, "") || null;
}

async function mirrorThroughApi(assetKey, sourceUrl, mirrorApiOrigin) {
  const url = `${mirrorApiOrigin}/assets/${encodeURIComponent(assetKey)}?src=${encodeURIComponent(sourceUrl)}`;
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Mirror API returned HTTP ${response.status} for ${assetKey}`);
}

async function main() {
  const mirrorApiOrigin = getMirrorApiOrigin();
  const objectStorage = mirrorApiOrigin ? null : createObjectStorageClient(process.env);
  if (!mirrorApiOrigin && !objectStorage) throw new Error("S3 env or --mirror-api-origin is required");

  const catalog = await loadPatchChangeCatalog(dbSchema, db);
  const assetStore = objectStorage ? await createGuideAssetStore(process.env, {
    objectStorage,
    throwOnMirrorError: true,
  }) : null;
  let uploaded = 0;
  let skipped = 0;

  for (const { kind, slug, record } of [
    ...FALLBACK_ITEM_SLUGS.map((slug) => ({ kind: "item", slug, record: [...catalog.items.values()].find((item) => item.slug === slug) })),
    ...FALLBACK_RUNE_SLUGS.map((slug) => ({ kind: "rune", slug, record: catalog.runeRecords.find((rune) => rune.slug === slug) })),
  ]) {
    const sourceUrl = record?.tooltipImageUrl || record?.imageUrl;
    if (!sourceUrl) throw new Error(`No catalog image source for ${slug}`);

    const assetKey = buildGuideAssetKey("guide", kind, slug, "image");
    if (mirrorApiOrigin) {
      await mirrorThroughApi(assetKey, sourceUrl, mirrorApiOrigin);
      uploaded += 1;
      console.log(`[patch-note-assets] ${slug} -> checked/mirrored through API`);
      continue;
    }

    const storageKey = buildGuideAssetStorageKey(assetKey, sourceUrl);
    if (await objectStorage.objectExists(storageKey)) {
      skipped += 1;
      console.log(`[patch-note-assets] ${slug} -> already exists`);
      continue;
    }

    await assetStore.mirror(assetKey, sourceUrl);
    if (!(await objectStorage.objectExists(storageKey))) {
      throw new Error(`S3 object missing after mirror: ${storageKey}`);
    }
    uploaded += 1;
    console.log(`[patch-note-assets] ${slug} -> uploaded missing object`);
  }

  console.log(JSON.stringify({ uploaded, skipped }, null, 2));
}

main()
  .catch((error) => {
    console.error("[patch-note-assets] sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
