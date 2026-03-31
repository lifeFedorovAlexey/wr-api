import "dotenv/config";

import { db } from "../db/client.js";
import { guideOfficialMeta } from "../db/schema.js";
import {
  buildGuideHeroMediaStorageKey,
  buildPublicGuideHeroMediaPath,
} from "../lib/guideHeroMedia.mjs";
import { createObjectStorageClient, shouldUseS3PublicUrls } from "../lib/objectStorage.mjs";

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dryRun: false,
    force: false,
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

    options.slugs.push(String(arg || "").trim().toLowerCase());
  }

  return options;
}

async function fetchVideoBuffer(url, slug) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "wr-api-hero-media-backfill/1.0",
    },
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
}

async function objectExists(publicUrl) {
  if (!publicUrl) return false;

  try {
    const response = await fetch(publicUrl, {
      method: "HEAD",
      redirect: "follow",
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseCliArgs(process.argv);
  const objectStorage = createObjectStorageClient(process.env);

  if (!objectStorage) {
    throw new Error("S3 env is not configured");
  }

  const rows = await db.select().from(guideOfficialMeta);
  const filteredRows = rows.filter((row) => {
    const slug = String(row?.guideSlug || "").trim().toLowerCase();
    if (!slug || !row?.heroRemoteVideoUrl) return false;
    if (!options.slugs.length) return true;
    return options.slugs.includes(slug);
  });

  const summary = {
    total: filteredRows.length,
    uploaded: [],
    skipped: [],
    failed: [],
    s3PublicMode: shouldUseS3PublicUrls(process.env),
  };

  for (const row of filteredRows) {
    const slug = String(row.guideSlug || "").trim().toLowerCase();
    const remoteUrl = String(row.heroRemoteVideoUrl || "").trim();
    const storageKey = buildGuideHeroMediaStorageKey(slug);
    const publicUrl = buildPublicGuideHeroMediaPath(slug, process.env);

    try {
      if (!options.force && shouldUseS3PublicUrls(process.env) && (await objectExists(publicUrl))) {
        summary.skipped.push({ slug, reason: "already-exists", publicUrl });
        continue;
      }

      if (options.dryRun) {
        summary.skipped.push({ slug, reason: "dry-run", storageKey, remoteUrl });
        continue;
      }

      const body = await fetchVideoBuffer(remoteUrl, slug);
      await objectStorage.uploadBuffer(
        body,
        storageKey,
        "video/mp4",
        "public, max-age=31536000, immutable",
      );

      summary.uploaded.push({
        slug,
        bytes: body.length,
        storageKey,
      });
    } catch (error) {
      summary.failed.push({
        slug,
        remoteUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[backfill-guide-hero-media] error:", error);
  process.exit(1);
});
