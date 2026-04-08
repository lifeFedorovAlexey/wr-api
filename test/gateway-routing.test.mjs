import test from "node:test";
import assert from "node:assert/strict";

import { isAuthGatewayPath } from "../lib/gatewayRouting.mjs";
import { pickGatewayUpstream } from "../lib/gatewayProxy.mjs";

test("isAuthGatewayPath keeps admin, user and webapp routes on auth upstream", () => {
  assert.equal(isAuthGatewayPath("/api/admin/session"), true);
  assert.equal(isAuthGatewayPath("/api/admin/users"), true);
  assert.equal(isAuthGatewayPath("/api/user/session"), true);
  assert.equal(isAuthGatewayPath("/api/user/profile"), true);
  assert.equal(isAuthGatewayPath("/api/webapp-open"), true);
});

test("isAuthGatewayPath keeps public and asset routes on public upstream", () => {
  assert.equal(isAuthGatewayPath("/api/health"), false);
  assert.equal(isAuthGatewayPath("/api/guides"), false);
  assert.equal(isAuthGatewayPath("/api/guides/rakan"), false);
  assert.equal(isAuthGatewayPath("/icons/rakan"), false);
  assert.equal(isAuthGatewayPath("/assets/guide-item-control-ward-image.png"), false);
});

test("pickGatewayUpstream maps pathnames to the expected internal app", () => {
  assert.equal(pickGatewayUpstream("/api/admin/session"), "auth");
  assert.equal(pickGatewayUpstream("/api/user/session"), "auth");
  assert.equal(pickGatewayUpstream("/api/webapp-open"), "auth");
  assert.equal(pickGatewayUpstream("/api/guides"), "public");
  assert.equal(pickGatewayUpstream("/api/champions"), "public");
});
