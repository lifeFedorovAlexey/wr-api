import test from "node:test";
import assert from "node:assert/strict";

test("normalizeUserSessionSecret reads dedicated USER_SESSION_SECRET", () => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/wr_api";
  return import("../lib/siteUserAuth.mjs").then(({ normalizeUserSessionSecret }) => {
    assert.equal(
      normalizeUserSessionSecret({ USER_SESSION_SECRET: "user-secret" }),
      "user-secret",
    );
    assert.equal(
      normalizeUserSessionSecret({ ADMIN_SESSION_SECRET: "admin-secret" }),
      "",
    );
  });
});

test("user exchange envelope round-trips only with USER_SESSION_SECRET", async () => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/wr_api";
  const {
    createSignedUserExchangeEnvelope,
    verifySignedUserExchangeEnvelope,
  } = await import("../lib/siteUserAuth.mjs");

  const env = {
    USER_SESSION_SECRET: "user-secret",
    ADMIN_SESSION_SECRET: "admin-secret",
  };

  const envelope = createSignedUserExchangeEnvelope(
    {
      profile: {
        provider: "vk",
        subject: "123",
      },
    },
    env,
  );

  const verified = verifySignedUserExchangeEnvelope(
    envelope.payload,
    envelope.signature,
    env,
  );
  const rejectedWithAdminOnly = verifySignedUserExchangeEnvelope(
    envelope.payload,
    envelope.signature,
    { ADMIN_SESSION_SECRET: "admin-secret" },
  );

  assert.equal(verified?.profile?.provider, "vk");
  assert.equal(rejectedWithAdminOnly, null);
});

test("mergeSiteAndAdminRoles keeps user role and dedupes admin roles", async () => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/wr_api";
  const { mergeSiteAndAdminRoles } = await import("../lib/siteUserAuth.mjs");

  assert.deepEqual(mergeSiteAndAdminRoles(["admin", "owner", "admin"]), [
    "user",
    "admin",
    "owner",
  ]);
  assert.deepEqual(mergeSiteAndAdminRoles([]), ["user"]);
});

test("normalizeWildRiftHandle accepts riot ids with spaces and alphanumeric tag", async () => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/wr_api";
  const { normalizeWildRiftHandle } = await import("../lib/siteUserAuth.mjs");

  assert.equal(normalizeWildRiftHandle("life on fire#7595"), "life on fire#7595");
  assert.equal(normalizeWildRiftHandle("Life_On_Fire#EUW1"), "Life_On_Fire#EUW1");
  assert.equal(normalizeWildRiftHandle("ab#12"), null);
  assert.equal(normalizeWildRiftHandle("name#12"), null);
  assert.equal(normalizeWildRiftHandle("name without tag"), null);
});
