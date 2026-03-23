import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicSkinAssetPath,
  buildSkinAssetKey,
  buildSkinSlug,
  normalizeSkinAssetPath,
} from "../lib/skins.mjs";

test("buildSkinSlug normalizes champion and skin names", () => {
  assert.equal(
    buildSkinSlug("Aatrox", "Blood Moon Aatrox"),
    "aatrox-blood-moon-aatrox",
  );
});

test("skin asset helpers build proxied wr-api paths", () => {
  assert.equal(
    buildSkinAssetKey("aatrox", "Blood Moon Aatrox", "image"),
    "skin-aatrox-blood-moon-aatrox-image",
  );

  assert.equal(
    buildPublicSkinAssetPath(
      "aatrox",
      "Blood Moon Aatrox",
      "model",
      "https://cdn.modelviewer.lol/lol/models/aatrox/266007/model.glb",
    ),
    "/wr-api/assets/skin-aatrox-blood-moon-aatrox-model?src=https%3A%2F%2Fcdn.modelviewer.lol%2Flol%2Fmodels%2Faatrox%2F266007%2Fmodel.glb",
  );
});

test("normalizeSkinAssetPath leaves local paths and wraps remote ones", () => {
  assert.equal(
    normalizeSkinAssetPath("ahri", "Arcade Ahri", "image", "/wr-api/assets/local-file"),
    "/wr-api/assets/local-file",
  );

  assert.equal(
    normalizeSkinAssetPath(
      "ahri",
      "Arcade Ahri",
      "image",
      "https://cmsassets.rgpub.io/example.jpg",
    ),
    "/wr-api/assets/skin-ahri-arcade-ahri-image?src=https%3A%2F%2Fcmsassets.rgpub.io%2Fexample.jpg",
  );
});
