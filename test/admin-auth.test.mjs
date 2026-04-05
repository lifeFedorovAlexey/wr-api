import test from "node:test";
import assert from "node:assert/strict";

import { isAuthorizedBySecrets } from "../api/utils/adminAuth.js";
import { AUTH_PROFILES } from "../api/utils/authProfiles.js";

test("isAuthorizedBySecrets accepts bearer token from configured env names", () => {
  const req = {
    headers: {
      authorization: "Bearer secret-token",
    },
  };

  const authorized = isAuthorizedBySecrets(req, {
    env: {
      CHAMPIONS_SYNC_TOKEN: "secret-token",
    },
    tokenEnvNames: ["CHAMPIONS_SYNC_TOKEN"],
  });

  assert.equal(authorized, true);
});

test("isAuthorizedBySecrets accepts custom secret header", () => {
  const req = {
    headers: {
      "x-champions-sync-secret": "sync-secret",
    },
  };

  const authorized = isAuthorizedBySecrets(req, {
    env: {
      CHAMPIONS_SYNC_SECRET: "sync-secret",
    },
    secretHeader: "x-champions-sync-secret",
    secretEnvNames: ["CHAMPIONS_SYNC_SECRET"],
  });

  assert.equal(authorized, true);
});

test("isAuthorizedBySecrets rejects empty and mismatched values", () => {
  const req = {
    headers: {
      authorization: "Bearer wrong-token",
      "x-news-sync-secret": "wrong-secret",
    },
  };

  const authorized = isAuthorizedBySecrets(req, {
    env: {
      NEWS_SYNC_TOKEN: "expected-token",
      NEWS_SYNC_SECRET: "expected-secret",
    },
    tokenEnvNames: ["NEWS_SYNC_TOKEN"],
    secretHeader: "x-news-sync-secret",
    secretEnvNames: ["NEWS_SYNC_SECRET"],
  });

  assert.equal(authorized, false);
});

test("guides auth profile only relies on the dedicated guides secret", () => {
  assert.deepEqual(AUTH_PROFILES.guidesSync, {
    secretHeader: "x-guides-sync-secret",
    secretEnvNames: ["GUIDES_SYNC_SECRET"],
  });
});
