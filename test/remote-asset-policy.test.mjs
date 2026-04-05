import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedRemoteAssetUrl } from "../lib/remoteAssetPolicy.mjs";

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
});

test("rejects localhost, ip literals, and non-https asset sources", () => {
  assert.equal(isAllowedRemoteAssetUrl("http://wildrift.leagueoflegends.com/file.png"), false);
  assert.equal(isAllowedRemoteAssetUrl("https://127.0.0.1/private"), false);
  assert.equal(isAllowedRemoteAssetUrl("https://localhost/private"), false);
  assert.equal(isAllowedRemoteAssetUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isAllowedRemoteAssetUrl("https://evil.example.com/file.png"), false);
});
