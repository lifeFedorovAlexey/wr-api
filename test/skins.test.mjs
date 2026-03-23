import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicSkinAssetPath,
  buildSkinAssetKey,
  buildSkinSlug,
  normalizeSkinAssetPath,
  toSkinDto,
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

test("skin asset helpers return direct S3 urls when public mode is enabled", () => {
  const env = {
    S3_ENDPOINT: "https://s3.twcstorage.ru",
    S3_BUCKET: "bucket-name",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_PUBLIC_BASE_URL: "https://s3.twcstorage.ru/bucket-name",
    ASSET_PUBLIC_MODE: "s3",
  };

  assert.equal(
    normalizeSkinAssetPath(
      "ahri",
      "Arcade Ahri",
      "image",
      "https://cmsassets.rgpub.io/example.jpg",
      env,
    ),
    "https://s3.twcstorage.ru/bucket-name/assets/skin-ahri-arcade-ahri-image.jpg",
  );
});

test("toSkinDto prefers source urls and rebuilds public asset urls from them", () => {
  const env = {
    S3_ENDPOINT: "https://s3.twcstorage.ru",
    S3_BUCKET: "bucket-name",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_PUBLIC_BASE_URL: "https://s3.twcstorage.ru/bucket-name",
    ASSET_PUBLIC_MODE: "s3",
  };

  const dto = toSkinDto(
    {
      championSlug: "ahri",
      skinName: "Arcade Ahri",
      imageSourceUrl: "https://cmsassets.rgpub.io/example.jpg",
      imageAssetPath: "/wr-api/assets/old-local-image",
      modelSourceUrl: "https://cdn.modelviewer.lol/example.glb",
      modelAssetPath: "/wr-api/assets/old-local-model",
      has3d: true,
    },
    env,
  );

  assert.equal(dto.image.preview, "https://s3.twcstorage.ru/bucket-name/assets/skin-ahri-arcade-ahri-image.jpg");
  assert.equal(dto.model?.cdn, "https://s3.twcstorage.ru/bucket-name/assets/skin-ahri-arcade-ahri-model.glb");
});