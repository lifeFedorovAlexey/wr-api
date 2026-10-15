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
];

async function main() {
  const objectStorage = createObjectStorageClient(process.env);
  if (!objectStorage) throw new Error("S3 env is not configured");

  const catalog = await loadPatchChangeCatalog(dbSchema, db);
  const assetStore = await createGuideAssetStore(process.env, {
    throwOnMirrorError: true,
  });
  let uploaded = 0;
  let skipped = 0;

  for (const slug of FALLBACK_ITEM_SLUGS) {
    const item = catalog.items.get(slug);
    const sourceUrl = item?.tooltipImageUrl || item?.imageUrl;
    if (!sourceUrl) throw new Error(`No catalog image source for ${slug}`);

    const assetKey = buildGuideAssetKey("guide", "item", item.slug, "image");
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
