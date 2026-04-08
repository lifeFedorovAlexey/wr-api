import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedRemoteAssetUrl,
  normalizeRemoteAssetUrl,
} from "../lib/remoteAssetPolicy.mjs";

test("allows known remote asset hosts over https", () => {
  assert.equal(
    isAllowedRemoteAssetUrl("https://wildrift.leagueoflegends.com/path/to/file.png"),
    true,
  );
  assert.equal(
    isAllowedRemoteAssetUrl("https://cmsassets.rgpub.io/example.jpg"),
    true,
  );
  assert.equal(
    isAllowedRemoteAssetUrl("https://cdn.modelviewer.lol/example.glb"),
    true,
  );
  assert.equal(
    isAllowedRemoteAssetUrl("https://assets.riftgg.app/items/control-ward.webp"),
    true,
  );
  assert.equal(
    isAllowedRemoteAssetUrl("https://support-wildrift.riotgames.com/hc/article_attachments/360088706614"),
    true,
  );
  assert.equal(
    isAllowedRemoteAssetUrl("http://wildrift.leagueoflegends.com/file.png"),
    true,
  );
  assert.equal(
    isAllowedRemoteAssetUrl("//game.gtimg.cn/images/icon.png"),
    true,
  );
});

test("normalizes remote asset urls before validation", () => {
  assert.equal(
    normalizeRemoteAssetUrl("http://wildrift.leagueoflegends.com/file.png"),
    "https://wildrift.leagueoflegends.com/file.png",
  );
  assert.equal(
    normalizeRemoteAssetUrl("//game.gtimg.cn/images/icon.png"),
    "https://game.gtimg.cn/images/icon.png",
  );
});

test("rejects localhost, ip literals, and disallowed hosts", () => {
  assert.equal(isAllowedRemoteAssetUrl("https://127.0.0.1/private"), false);
  assert.equal(isAllowedRemoteAssetUrl("https://localhost/private"), false);
  assert.equal(isAllowedRemoteAssetUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isAllowedRemoteAssetUrl("https://evil.example.com/file.png"), false);
});
