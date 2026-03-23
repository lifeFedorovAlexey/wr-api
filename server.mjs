import "dotenv/config";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import championsHandler from "./api/champions.js";
import championHistoryHandler from "./api/champion-history.js";
import cronImportChampionsHandler from "./api/cron-import-champions.js";
import guidesDetailHandler from "./api/guides-detail.js";
import guidesImportHandler from "./api/guides-import.js";
import guidesHandler from "./api/guides.js";
import latestStatsSnapshotHandler from "./api/latest-stats-snapshot.js";
import skinsDetailHandler from "./api/skins-detail.js";
import skinsHandler from "./api/skins.js";
import tierlistBulkHandler from "./api/tierlist-bulk.js";
import tierlistHandler from "./api/tierlist.js";
import updatedAtHandler from "./api/updated-at.js";
import winratesSnapshotHandler from "./api/winrates-snapshot.js";
import webappOpenHandler from "./api/webapp-open.js";
import { createChampionIconStore } from "./lib/championIcons.mjs";
import { createGuideAssetStore, detectGuideAssetContentType } from "./lib/guideAssets.mjs";
import { resolveGuideHeroMediaFilePath } from "./lib/guideHeroMedia.mjs";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const iconStorePromise = createChampionIconStore();
const guideAssetStorePromise = createGuideAssetStore();

const routes = new Map([
  ["/api/champions", championsHandler],
  ["/api/champion-history", championHistoryHandler],
  ["/api/cron-import-champions", cronImportChampionsHandler],
  ["/api/guides", guidesHandler],
  ["/api/guides/import", guidesImportHandler],
  ["/api/latest-stats-snapshot", latestStatsSnapshotHandler],
  ["/api/skins", skinsHandler],
  ["/api/tierlist-bulk", tierlistBulkHandler],
  ["/api/tierlist", tierlistHandler],
  ["/api/updated-at", updatedAtHandler],
  ["/api/winrates-snapshot", winratesSnapshotHandler],
  ["/api/webapp-open", webappOpenHandler],
]);

function patchResponse(res) {
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };

  res.json = function json(payload) {
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }

    res.end(JSON.stringify(payload));
    return res;
  };

  return res;
}

async function readJsonBody(req) {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function attachQuery(req, url) {
  req.query = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(req.query, key)) {
      const prev = req.query[key];
      req.query[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
      continue;
    }

    req.query[key] = value;
  }
}

async function tryServeIcon(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  if (!url.pathname.startsWith("/icons/")) {
    return false;
  }

  const slug = path.basename(url.pathname.slice("/icons/".length));
  if (!slug) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }

  const sourceUrl =
    typeof url.searchParams.get("src") === "string"
      ? url.searchParams.get("src")
      : null;

  const iconStore = await iconStorePromise;

  if (sourceUrl) {
    await iconStore.mirror(slug, sourceUrl);
  }

  const filePath = iconStore.getCachedFilePath(slug);
  if (!filePath) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === ".webp"
      ? "image/webp"
      : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".avif"
          ? "image/avif"
          : "image/png";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return true;
  }

  createReadStream(filePath).pipe(res);
  return true;
}

async function tryServeGuideAsset(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  if (!url.pathname.startsWith("/assets/")) {
    return false;
  }

  const assetKey = path.basename(decodeURIComponent(url.pathname.slice("/assets/".length)));
  if (!assetKey) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }

  const sourceUrl =
    typeof url.searchParams.get("src") === "string"
      ? url.searchParams.get("src")
      : null;

  const guideAssetStore = await guideAssetStorePromise;

  if (sourceUrl) {
    await guideAssetStore.mirror(assetKey, sourceUrl);
  }

  const filePath = guideAssetStore.getCachedFilePath(assetKey);
  if (!filePath) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }

  res.setHeader("Content-Type", detectGuideAssetContentType(filePath));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return true;
  }

  createReadStream(filePath).pipe(res);
  return true;
}

async function tryServeGuideHeroMedia(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  if (!url.pathname.startsWith("/hero-media/")) {
    return false;
  }

  const baseName = path.basename(decodeURIComponent(url.pathname.slice("/hero-media/".length)));
  const slug = baseName.replace(/\.mp4$/i, "");
  if (!slug) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }

  const filePath = resolveGuideHeroMediaFilePath(slug);
  if (!filePath) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return true;
  }

  createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const handler = routes.get(url.pathname);

  patchResponse(res);
  attachQuery(req, url);

  if (await tryServeIcon(req, res, url)) {
    return;
  }

  if (await tryServeGuideAsset(req, res, url)) {
    return;
  }

  if (await tryServeGuideHeroMedia(req, res, url)) {
    return;
  }

  if (!handler && url.pathname.startsWith("/api/guides/")) {
    req.params = {
      slug: decodeURIComponent(url.pathname.slice("/api/guides/".length)),
    };

    try {
      req.body = await readJsonBody(req);
      await guidesDetailHandler(req, res);
    } catch (error) {
      const statusCode =
        error?.statusCode && Number.isInteger(error.statusCode)
          ? error.statusCode
          : 500;

      if (!res.headersSent) {
        res.status(statusCode).json({
          error: statusCode === 400 ? "Bad Request" : "Internal Server Error",
        });
      }

      console.error("[wr-api] server error:", error);
    }
    return;
  }

  if (!handler && url.pathname.startsWith("/api/skins/")) {
    req.params = {
      slug: decodeURIComponent(url.pathname.slice("/api/skins/".length)),
    };

    try {
      req.body = await readJsonBody(req);
      await skinsDetailHandler(req, res);
    } catch (error) {
      const statusCode =
        error?.statusCode && Number.isInteger(error.statusCode)
          ? error.statusCode
          : 500;

      if (!res.headersSent) {
        res.status(statusCode).json({
          error: statusCode === 400 ? "Bad Request" : "Internal Server Error",
        });
      }

      console.error("[wr-api] server error:", error);
    }
    return;
  }

  if (!handler) {
    res.status(404).json({ error: "Not Found" });
    return;
  }

  try {
    req.body = await readJsonBody(req);
    await handler(req, res);
  } catch (error) {
    const statusCode =
      error?.statusCode && Number.isInteger(error.statusCode)
        ? error.statusCode
        : 500;

    if (!res.headersSent) {
      res.status(statusCode).json({
        error: statusCode === 400 ? "Bad Request" : "Internal Server Error",
      });
    }

    console.error("[wr-api] server error:", error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[wr-api] listening on http://${HOST}:${PORT}`);
});
