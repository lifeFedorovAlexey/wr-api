import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { buildObjectStoragePublicUrl, createObjectStorageClient } from "../lib/objectStorage.mjs";

const SOURCE_STRIPS = [
  {
    sourceUrl: "https://support-wildrift.riotgames.com/hc/article_attachments/360088706614",
    ranks: ["iron", "bronze", "silver", "gold", "platinum"],
  },
  {
    sourceUrl: "https://support-wildrift.riotgames.com/hc/article_attachments/360088706654",
    ranks: ["emerald", "diamond", "master", "grandmaster", "challenger", "sovereign"],
  },
];

const ALPHA_THRESHOLD = 12;
const CROP_PADDING = 8;
const CACHE_CONTROL = "public, max-age=31536000, immutable";

function parseCli(argv) {
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    requireS3: argv.includes("--require-s3"),
  };
}

function groupActiveIndices(values) {
  const groups = [];
  let start = -1;

  for (let index = 0; index < values.length; index += 1) {
    if (values[index]) {
      if (start === -1) start = index;
      continue;
    }

    if (start !== -1) {
      groups.push([start, index - 1]);
      start = -1;
    }
  }

  if (start !== -1) {
    groups.push([start, values.length - 1]);
  }

  return groups;
}

function extractOpaqueBounds(raw, info, left, right) {
  const { width, height, channels } = info;
  let minY = height;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const alpha = raw[(y * width + x) * channels + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return maxY >= 0 ? { minY, maxY } : null;
}

async function sliceStrip(stripBuffer, expectedCount) {
  const prepared = sharp(stripBuffer).ensureAlpha();
  const { data, info } = await prepared.raw().toBuffer({ resolveWithObject: true });
  const activeColumns = [];

  for (let x = 0; x < info.width; x += 1) {
    let columnActive = false;

    for (let y = 0; y < info.height; y += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha > ALPHA_THRESHOLD) {
        columnActive = true;
        break;
      }
    }

    activeColumns.push(columnActive);
  }

  const columnGroups = groupActiveIndices(activeColumns);
  if (columnGroups.length !== expectedCount) {
    throw new Error(`expected ${expectedCount} rank icons, got ${columnGroups.length}`);
  }

  const segments = [];

  for (const [left, right] of columnGroups) {
    const bounds = extractOpaqueBounds(data, info, left, right);
    if (!bounds) {
      throw new Error("failed to detect icon bounds");
    }

    const cropLeft = Math.max(0, left - CROP_PADDING);
    const cropTop = Math.max(0, bounds.minY - CROP_PADDING);
    const cropRight = Math.min(info.width - 1, right + CROP_PADDING);
    const cropBottom = Math.min(info.height - 1, bounds.maxY + CROP_PADDING);

    segments.push({
      left: cropLeft,
      top: cropTop,
      width: cropRight - cropLeft + 1,
      height: cropBottom - cropTop + 1,
    });
  }

  return Promise.all(
    segments.map((segment) =>
      sharp(stripBuffer)
        .extract(segment)
        .png()
        .toBuffer(),
    ),
  );
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const objectStorage = createObjectStorageClient(process.env);

  if (options.requireS3 && !objectStorage) {
    throw new Error("S3 env is not configured");
  }

  const tempDir = path.resolve(process.cwd(), ".runtime", "profile-rank-assets");
  await mkdir(tempDir, { recursive: true });

  const summary = {
    total: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    assets: [],
  };

  for (const strip of SOURCE_STRIPS) {
    const stripBuffer = await fetchBuffer(strip.sourceUrl);
    const iconBuffers = await sliceStrip(stripBuffer, strip.ranks.length);

    for (let index = 0; index < strip.ranks.length; index += 1) {
      const rank = strip.ranks[index];
      const fileName = `profile-rank-${rank}.png`;
      const key = `assets/${fileName}`;
      const outputPath = path.join(tempDir, fileName);
      const publicUrl =
        buildObjectStoragePublicUrl(key, process.env) || `/wr-api/assets/${fileName}`;

      summary.total += 1;

      try {
        await writeFile(outputPath, iconBuffers[index]);

        if (options.dryRun) {
          summary.skipped += 1;
          summary.assets.push({ rank, key, publicUrl, status: "dry-run" });
          continue;
        }

        if (objectStorage && !options.force && (await objectStorage.objectExists(key))) {
          summary.skipped += 1;
          summary.assets.push({ rank, key, publicUrl, status: "exists" });
          continue;
        }

        if (objectStorage) {
          await objectStorage.uploadBuffer(iconBuffers[index], key, "image/png", CACHE_CONTROL);
        }

        summary.uploaded += 1;
        summary.assets.push({ rank, key, publicUrl, status: "uploaded" });
      } catch (error) {
        summary.failed += 1;
        summary.assets.push({
          rank,
          key,
          publicUrl,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[backfill-profile-rank-assets] error:", error);
  process.exit(1);
});
