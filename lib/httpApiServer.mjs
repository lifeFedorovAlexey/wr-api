import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import { readJsonBody } from "../api/utils/request-body.js";
import { createChampionIconStore, normalizeIconSize } from "./championIcons.mjs";
import { createGuideAssetStore, detectGuideAssetContentType } from "./guideAssets.mjs";
import { resolveGuideHeroMediaFilePath } from "./guideHeroMedia.mjs";
import { isAllowedRemoteAssetUrl } from "./remoteAssetPolicy.mjs";

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

function respondInternalError(res, error, logLabel) {
  const statusCode =
    error?.statusCode && Number.isInteger(error.statusCode) ? error.statusCode : 500;

  if (!res.headersSent) {
    res.status(statusCode).json({
      error: statusCode === 400 ? "Bad Request" : "Internal Server Error",
    });
  }

  console.error(`${logLabel} server error:`, error);
}

export function createApiServer({
  routes,
  detailRoutes = [],
  enableIcons = false,
  enableGuideAssets = false,
  enableGuideHeroMedia = false,
  logLabel = "[wr-api]",
}) {
  const iconStorePromise = enableIcons ? createChampionIconStore() : null;
  const guideAssetStorePromise = enableGuideAssets ? createGuideAssetStore() : null;

  async function tryServeIcon(req, res, url) {
    if (!enableIcons || (req.method !== "GET" && req.method !== "HEAD")) {
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
      typeof url.searchParams.get("src") === "string" ? url.searchParams.get("src") : null;
    const requestedSize = normalizeIconSize(url.searchParams.get("size"));

    if (sourceUrl && !isAllowedRemoteAssetUrl(sourceUrl)) {
      res.status(400).json({ error: "Invalid asset source" });
      return true;
    }

    const iconStore = await iconStorePromise;

    if (sourceUrl) {
      await iconStore.mirror(slug, sourceUrl);
    }

    const filePath = requestedSize
      ? await iconStore.ensureVariant(slug, requestedSize)
      : iconStore.getCachedFilePath(slug);
    if (!filePath) {
      res.status(404).json({ error: "Not Found" });
      return true;
    }

    const contentType = requestedSize
      ? "image/webp"
      : (() => {
          const ext = path.extname(filePath).toLowerCase();
          return ext === ".webp"
            ? "image/webp"
            : ext === ".jpg" || ext === ".jpeg"
              ? "image/jpeg"
              : ext === ".avif"
                ? "image/avif"
                : "image/png";
        })();

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
    if (!enableGuideAssets || (req.method !== "GET" && req.method !== "HEAD")) {
      return false;
    }

    if (!url.pathname.startsWith("/assets/")) {
      return false;
    }

    const assetKey = path.basename(
      decodeURIComponent(url.pathname.slice("/assets/".length)),
    );
    if (!assetKey) {
      res.status(404).json({ error: "Not Found" });
      return true;
    }

    const sourceUrl =
      typeof url.searchParams.get("src") === "string" ? url.searchParams.get("src") : null;

    if (sourceUrl && !isAllowedRemoteAssetUrl(sourceUrl)) {
      res.status(400).json({ error: "Invalid asset source" });
      return true;
    }

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
    if (!enableGuideHeroMedia || (req.method !== "GET" && req.method !== "HEAD")) {
      return false;
    }

    if (!url.pathname.startsWith("/hero-media/")) {
      return false;
    }

    const baseName = path.basename(
      decodeURIComponent(url.pathname.slice("/hero-media/".length)),
    );
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

  return http.createServer(async (req, res) => {
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

    if (handler) {
      try {
        req.body = await readJsonBody(req);
        await handler(req, res);
      } catch (error) {
        respondInternalError(res, error, logLabel);
      }
      return;
    }

    for (const detailRoute of detailRoutes) {
      if (!detailRoute.matches(url.pathname)) {
        continue;
      }

      req.params = detailRoute.getParams(url.pathname);

      try {
        req.body = await readJsonBody(req);
        await detailRoute.handler(req, res);
      } catch (error) {
        respondInternalError(res, error, logLabel);
      }
      return;
    }

    if (!handler) {
      res.status(404).json({ error: "Not Found" });
      return;
    }
  });
}

export function listenServer(
  server,
  {
    port = Number(process.env.PORT || 3001),
    host = process.env.HOST || "127.0.0.1",
    logLabel = "[wr-api]",
  } = {},
) {
  server.listen(port, host, () => {
    console.log(`${logLabel} listening on http://${host}:${port}`);
  });

  return server;
}
