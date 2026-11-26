import assert from "node:assert/strict";
import test from "node:test";

import { mirrorGuideAssetThroughApi } from "../lib/guideAssetMirrorCheck.mjs";

const assetKey = "guide-item-pickaxe-image";
const sourceUrl = "https://hub-game.com/wildrift/images/items/webp/wr_pickaxe.webp";
const mirrorApiOrigin = "https://wildriftallstats.ru/wr-api";

test("mirror API check reports a public-store 404 separately from the API redirect", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) {
      return new Response(null, { status: 404 });
    }
    if (requests.length === 2) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/assets/guide-item-pickaxe-image.webp" },
      });
    }
    return new Response(null, { status: 404 });
  };

  await assert.rejects(
    mirrorGuideAssetThroughApi(assetKey, sourceUrl, mirrorApiOrigin, fetchImpl),
    /Mirror API returned HTTP 302.*redirect target returned HTTP 404 at https:\/\/cdn\.example\.com\/assets\/guide-item-pickaxe-image\.webp/,
  );

  assert.equal(requests.length, 3);
  assert.equal(requests[0].options.method, "HEAD");
  assert.equal(requests[0].options.redirect, "manual");
  assert.equal(new URL(requests[0].url).search, "");
  assert.equal(requests[1].options.method, "HEAD");
  assert.ok(new URL(requests[1].url).searchParams.has("src"));
  const sourceRequestUrl = new URL(requests[1].url);
  assert.equal(sourceRequestUrl.pathname, "/wr-api/api/assets/guide-item-pickaxe-image");
  assert.ok(sourceRequestUrl.searchParams.has("src"));
  assert.equal(requests[2].url, "https://cdn.example.com/assets/guide-item-pickaxe-image.webp");
});

test("mirror API check succeeds when its public-store redirect is reachable", async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(null, { status: 404 });
    }
    if (requestCount === 2) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn.example.com/assets/guide-item-pickaxe-image.webp" },
      });
    }
    return new Response(null, { status: 200 });
  };

  await mirrorGuideAssetThroughApi(assetKey, sourceUrl, mirrorApiOrigin, fetchImpl);
  assert.equal(requestCount, 3);
});

test("mirror API check skips source mirroring when the asset is already available", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(null, { status: 200 });
  };

  const status = await mirrorGuideAssetThroughApi(assetKey, sourceUrl, mirrorApiOrigin, fetchImpl);

  assert.equal(status, "already-available");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, "HEAD");
  assert.equal(new URL(requests[0].url).search, "");
});

test("mirror API check rejects an unavailable existing route without triggering mirroring", async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return new Response(null, { status: 503 });
  };

  await assert.rejects(
    mirrorGuideAssetThroughApi(assetKey, sourceUrl, mirrorApiOrigin, fetchImpl),
    /HTTP 503 while checking existing asset guide-item-pickaxe-image/,
  );
  assert.equal(requestCount, 1);
});
