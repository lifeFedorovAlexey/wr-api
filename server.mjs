import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import championsHandler from "./api/champions.js";
import championHistoryHandler from "./api/champion-history.js";
import cronImportChampionsHandler from "./api/cron-import-champions.js";
import latestStatsSnapshotHandler from "./api/latest-stats-snapshot.js";
import tierlistBulkHandler from "./api/tierlist-bulk.js";
import tierlistHandler from "./api/tierlist.js";
import updatedAtHandler from "./api/updated-at.js";
import winratesSnapshotHandler from "./api/winrates-snapshot.js";
import webappOpenHandler from "./api/webapp-open.js";
import { resolveIconsDir } from "./lib/championIcons.mjs";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const ICONS_DIR = resolveIconsDir();

const routes = new Map([
  ["/api/champions", championsHandler],
  ["/api/champion-history", championHistoryHandler],
  ["/api/cron-import-champions", cronImportChampionsHandler],
  ["/api/latest-stats-snapshot", latestStatsSnapshotHandler],
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

function tryServeIcon(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  if (!url.pathname.startsWith("/icons/")) {
    return false;
  }

  const fileName = path.basename(url.pathname.slice("/icons/".length));
  const filePath = path.join(ICONS_DIR, fileName);

  if (!fileName || !existsSync(filePath)) {
    res.status(404).json({ error: "Not Found" });
    return true;
  }

  const ext = path.extname(fileName).toLowerCase();
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const handler = routes.get(url.pathname);

  patchResponse(res);
  attachQuery(req, url);

  if (tryServeIcon(req, res, url)) {
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
