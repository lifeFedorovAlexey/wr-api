import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { client, db } from "../db/client.js";
import { guideOfficialMeta } from "../db/schema.js";
import {
  buildGuideHeroMediaFileName,
  buildGuideHeroMediaStorageKey,
  resolveGuideHeroMediaFilePath,
  resolveGuideHeroMediaDir,
} from "../lib/guideHeroMedia.mjs";
import { createObjectStorageClient, shouldUseS3PublicUrls } from "../lib/objectStorage.mjs";

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dryRun: false,
    force: false,
    requireS3: false,
    slugs: [],
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    if (arg === "--require-s3") {
      options.requireS3 = true;
      continue;
    }

    options.slugs.push(String(arg || "").trim().toLowerCase());
  }

  return options;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function logProgress({
  index,
  total,
  slug,
  outcome,
  uploaded,
  skipped,
  failed,
}) {
  console.log(
    `[backfill-guide-hero-media] ${index}/${total} ${slug} -> ${outcome} | uploaded=${uploaded} skipped=${skipped} failed=${failed}`,
  );
}

async function fetchVideoBuffer(url, slug) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "wr-api-hero-media-backfill/1.0",
        },
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `download failed for ${slug}: HTTP ${response.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (!buffer.length) {
        throw new Error(`download failed for ${slug}: empty body`);
      }

      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await wait(1000 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function main() {
  const options = parseCliArgs(process.argv);
  const objectStorage = createObjectStorageClient(process.env);
  const localHeroMediaDir = resolveGuideHeroMediaDir(process.env);
  const useS3 = Boolean(objectStorage);

  if (options.requireS3 && !useS3) {
    throw new Error("S3 env is not configured");
  }

  if (!useS3 && !localHeroMediaDir) {
    throw new Error("Neither S3 nor local hero media dir is configured");
  }

  const rows = await db.select().from(guideOfficialMeta);
  const rowsWithSlug = rows.filter((row) => String(row?.guideSlug || "").trim());
  const rowsMissingRemoteVideo = rowsWithSlug.filter((row) => !String(row?.heroRemoteVideoUrl || "").trim());
  const filteredRows = rowsWithSlug.filter((row) => {
    const slug = String(row?.guideSlug || "").trim().toLowerCase();
    if (!row?.heroRemoteVideoUrl) return false;
    if (!options.slugs.length) return true;
    return options.slugs.includes(slug);
  });

  const missingRemoteVideoSlugs = uniqueSorted(
    rowsMissingRemoteVideo.map((row) => String(row?.guideSlug || "").trim().toLowerCase()),
  );

  const summary = {
    totalGuideMetaRows: rows.length,
    totalGuideMetaRowsWithSlug: rowsWithSlug.length,
    totalEligible: filteredRows.length,
    missingRemoteVideoCount: missingRemoteVideoSlugs.length,
    missingRemoteVideoSlugs,
    total: filteredRows.length,
    uploaded: [],
    skipped: [],
    failed: [],
    s3PublicMode: shouldUseS3PublicUrls(process.env),
    storageMode: useS3 ? "s3" : "local",
  };

  console.log(
    `[backfill-guide-hero-media] start: totalRows=${rows.length}, withSlug=${rowsWithSlug.length}, eligible=${filteredRows.length}, missingRemoteVideo=${missingRemoteVideoSlugs.length}, storageMode=${summary.storageMode}, s3PublicMode=${summary.s3PublicMode}`,
  );

  if (missingRemoteVideoSlugs.length > 0) {
    console.log(
      `[backfill-guide-hero-media] missing remote hero video URL for: ${missingRemoteVideoSlugs.join(", ")}`,
    );
  }

  for (const [index, row] of filteredRows.entries()) {
    const slug = String(row.guideSlug || "").trim().toLowerCase();
    const remoteUrl = String(row.heroRemoteVideoUrl || "").trim();
    const storageKey = buildGuideHeroMediaStorageKey(slug);

    try {
      if (!options.force) {
        if (useS3 && (await objectStorage.objectExists(storageKey))) {
          summary.skipped.push({ slug, reason: "already-exists", storageKey });
          logProgress({
            index: index + 1,
            total: filteredRows.length,
            slug,
            outcome: "skip:already-exists",
            uploaded: summary.uploaded.length,
            skipped: summary.skipped.length,
            failed: summary.failed.length,
          });
          continue;
        }

        if (!useS3 && resolveGuideHeroMediaFilePath(slug, process.env)) {
          summary.skipped.push({
            slug,
            reason: "already-exists",
            localPath: resolveGuideHeroMediaFilePath(slug, process.env),
          });
          logProgress({
            index: index + 1,
            total: filteredRows.length,
            slug,
            outcome: "skip:already-exists",
            uploaded: summary.uploaded.length,
            skipped: summary.skipped.length,
            failed: summary.failed.length,
          });
          continue;
        }
      }

      if (options.dryRun) {
        summary.skipped.push({ slug, reason: "dry-run", storageKey, remoteUrl });
        logProgress({
          index: index + 1,
          total: filteredRows.length,
          slug,
          outcome: "skip:dry-run",
          uploaded: summary.uploaded.length,
          skipped: summary.skipped.length,
          failed: summary.failed.length,
        });
        continue;
      }

      const body = await fetchVideoBuffer(remoteUrl, slug);
      if (useS3) {
        await objectStorage.uploadBuffer(
          body,
          storageKey,
          "video/mp4",
          "public, max-age=31536000, immutable",
        );
      } else {
        await mkdir(localHeroMediaDir, { recursive: true });
        await writeFile(path.join(localHeroMediaDir, buildGuideHeroMediaFileName(slug)), body);
      }

      summary.uploaded.push({
        slug,
        bytes: body.length,
        storageKey: useS3 ? storageKey : null,
        localPath: useS3
          ? null
          : path.join(localHeroMediaDir, buildGuideHeroMediaFileName(slug)),
      });
      logProgress({
        index: index + 1,
        total: filteredRows.length,
        slug,
        outcome: "uploaded",
        uploaded: summary.uploaded.length,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      });
    } catch (error) {
      summary.failed.push({
        slug,
        remoteUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      logProgress({
        index: index + 1,
        total: filteredRows.length,
        slug,
        outcome: "failed",
        uploaded: summary.uploaded.length,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(async () => {
    try {
      await client.end();
    } catch (error) {
      console.warn(
        "[backfill-guide-hero-media] failed to close Postgres client:",
        error instanceof Error ? error.message : String(error),
      );
    }
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[backfill-guide-hero-media] error:", error);
    try {
      await client.end();
    } catch (closeError) {
      console.warn(
        "[backfill-guide-hero-media] failed to close Postgres client:",
        closeError instanceof Error ? closeError.message : String(closeError),
      );
    }
    process.exit(1);
  });
