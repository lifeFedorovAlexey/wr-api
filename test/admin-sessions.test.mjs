import test from "node:test";
import assert from "node:assert/strict";

const env = {
  ADMIN_SESSION_SECRET: "top-secret",
  ADMIN_BOOTSTRAP_EMAILS: "owner@example.com",
  ADMIN_BOOTSTRAP_TELEGRAM_IDS: "42",
  ADMIN_BOOTSTRAP_TELEGRAM_USERNAMES: "owner",
};

process.env.DATABASE_URL ||= "postgres://local:local@127.0.0.1:5432/local";

const {
  canBootstrapAdmin,
  createSignedExchangeEnvelope,
  verifySignedExchangeEnvelope,
  userHasAnyRole,
} = await import("../lib/adminAuth.mjs");

test("createSignedExchangeEnvelope round-trips a fresh envelope", () => {
  const envelope = createSignedExchangeEnvelope(
    {
      profile: {
        provider: "google",
        subject: "sub-1",
        email: "owner@example.com",
      },
    },
    env,
  );

  const decoded = verifySignedExchangeEnvelope(envelope.payload, envelope.signature, env);
  assert.equal(decoded?.profile?.provider, "google");
  assert.equal(decoded?.profile?.email, "owner@example.com");
});

test("verifySignedExchangeEnvelope rejects a tampered signature", () => {
  const envelope = createSignedExchangeEnvelope(
    {
      profile: {
        provider: "google",
        subject: "sub-1",
        email: "owner@example.com",
      },
    },
    env,
  );

  assert.equal(
    verifySignedExchangeEnvelope(envelope.payload, `${envelope.signature}x`, env),
    null,
  );
});

test("canBootstrapAdmin accepts configured bootstrap identities", () => {
  assert.equal(
    canBootstrapAdmin(
      { provider: "google", subject: "1", email: "owner@example.com" },
      env,
    ),
    true,
  );

  assert.equal(
    canBootstrapAdmin(
      { provider: "telegram", subject: "42", username: "owner" },
      env,
    ),
    true,
  );
});

test("userHasAnyRole matches owner or admin role membership", () => {
  assert.equal(userHasAnyRole({ roles: ["viewer", "admin"] }, ["owner", "admin"]), true);
  assert.equal(userHasAnyRole({ roles: ["viewer"] }, ["owner", "admin"]), false);
});
