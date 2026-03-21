import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";

import championsHandler from "./api/champions.js";
import championHistoryHandler from "./api/champion-history.js";
import cronImportChampionsHandler from "./api/cron-import-champions.js";
import tierlistBulkHandler from "./api/tierlist-bulk.js";
import tierlistHandler from "./api/tierlist.js";
import updatedAtHandler from "./api/updated-at.js";
import webappOpenHandler from "./api/webapp-open.js";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";

const routes = new Map([
  ["/api/champions", championsHandler],
  ["/api/champion-history", championHistoryHandler],
  ["/api/cron-import-champions", cronImportChampionsHandler],
  ["/api/tierlist-bulk", tierlistBulkHandler],
  ["/api/tierlist", tierlistHandler],
  ["/api/updated-at", updatedAtHandler],
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const handler = routes.get(url.pathname);

  patchResponse(res);
  attachQuery(req, url);

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
