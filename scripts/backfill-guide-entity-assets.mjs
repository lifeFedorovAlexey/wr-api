import "dotenv/config";

import { client, db } from "../db/client.js";
import { guideEntities } from "../db/schema.js";
import {
  buildGuideAssetKey,
  buildGuideAssetStorageKey,
  createGuideAssetStore,
  detectGuideAssetContentType,
} from "../lib/guideAssets.mjs";
import { createObjectStorageClient, shouldUseS3PublicUrls } from "../lib/objectStorage.mjs";
import { attachBackfillShutdown, parseBackfillCliArgs } from "./backfillShared.mjs";

function buildTasks(rows, options) {
  const tasks = [];

  for (const row of rows) {
    const slug = String(row?.slug || "").trim().toLowerCase();
    if (!slug) continue;
    if (options.slugs.length && !options.slugs.includes(slug)) continue;

    const kind = String(row?.kind || "").trim();

    if (row?.imageUrl) {
      tasks.push({
        kind,
        slug,
        field: "image",
        sourceUrl: String(row.imageUrl).trim(),
        assetKey: buildGuideAssetKey("guide", kind, slug, "image"),
      });
    }

    if (row?.tooltipImageUrl) {
      tasks.push({
        kind,
        slug,
        field: "tooltip",
        sourceUrl: String(row.tooltipImageUrl).trim(),
        assetKey: buildGuideAssetKey("guide", kind, slug, "tooltip"),
      });
    }
  }

  return tasks;
}

function logProgress({ index, total, task, outcome, mirrored, skipped, failed }) {
  console.log(
    `[backfill-guide-entity-assets] ${index}/${total} ${task.kind}:${task.slug}:${task.field} -> ${outcome} | mirrored=${mirrored} skipped=${skipped} failed=${failed}`,
  );
}

async function main() {
  const options = parseBackfillCliArgs(process.argv);
  const objectStorage = createObjectStorageClient(process.env);
  const guideAssetStore = await createGuideAssetStore(process.env);
  const useS3 = Boolean(objectStorage);

  if (options.requireS3 && !useS3) {
    throw new Error("S3 env is not configured");
  }

  const rows = await db.select().from(guideEntities);
  const tasks = buildTasks(rows, options);
  const summary = {
    totalRows: rows.length,
    totalTasks: tasks.length,
    mirrored: [],
    skipped: [],
    failed: [],
    s3PublicMode: shouldUseS3PublicUrls(process.env),
    storageMode: useS3 ? "s3+local-cache" : "local-cache",
  };

  console.log(
    `[backfill-guide-entity-assets] start: rows=${rows.length}, tasks=${tasks.length}, storageMode=${summary.storageMode}, s3PublicMode=${summary.s3PublicMode}`,
  );

  for (const [index, task] of tasks.entries()) {
    try {
      const cachedFilePath = guideAssetStore.getCachedFilePath(task.assetKey);
      const hasS3Object = cachedFilePath && useS3
        ? await objectStorage.objectExists(
            buildGuideAssetStorageKey(
              task.assetKey,
              task.sourceUrl,
              detectGuideAssetContentType(cachedFilePath),
            ),
          )
        : false;

      if (cachedFilePath && (!useS3 || hasS3Object) && !options.force) {
        summary.skipped.push({
          ...task,
          reason: "already-cached",
          cachedFilePath,
        });
        logProgress({
          index: index + 1,
          total: tasks.length,
          task,
          outcome: "skip:already-cached",
          mirrored: summary.mirrored.length,
          skipped: summary.skipped.length,
          failed: summary.failed.length,
        });
        continue;
      }

      if (options.dryRun) {
        summary.skipped.push({
          ...task,
          reason: "dry-run",
        });
        logProgress({
          index: index + 1,
          total: tasks.length,
          task,
          outcome: "skip:dry-run",
          mirrored: summary.mirrored.length,
          skipped: summary.skipped.length,
          failed: summary.failed.length,
        });
        continue;
      }

      const publicUrl = await guideAssetStore.mirror(task.assetKey, task.sourceUrl);
      summary.mirrored.push({
        ...task,
        publicUrl,
      });
      logProgress({
        index: index + 1,
        total: tasks.length,
        task,
        outcome: "mirrored",
        mirrored: summary.mirrored.length,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      });
    } catch (error) {
      summary.failed.push({
        ...task,
        error: error instanceof Error ? error.message : String(error),
      });
      logProgress({
        index: index + 1,
        total: tasks.length,
        task,
        outcome: "failed",
        mirrored: summary.mirrored.length,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

attachBackfillShutdown(main(), client, "backfill-guide-entity-assets");
