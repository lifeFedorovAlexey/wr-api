import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://local:local@127.0.0.1:5432/local";

const {
  createPublicTierlistCredentials,
  hashPublicTierlistEditToken,
  isAnonymousPublicTierlistExpired,
  normalizeRequiredPublicTierlistAuthorName,
  sanitizeStreamerTierlistSubmission,
  siteUserCanAppearInStreamerCatalog,
  STREAMER_TIERLIST_LANE_KEYS,
  STREAMER_TIERLIST_TIERS,
  userCanDeleteStreamerTierlist,
  verifyPublicTierlistEditToken,
} = await import("../lib/streamerTierlists.mjs");

test("public tierlist author name is required and normalized", () => {
  assert.equal(normalizeRequiredPublicTierlistAuthorName("  Игрок  "), "Игрок");
  assert.throws(
    () => normalizeRequiredPublicTierlistAuthorName("   "),
    /missing_author_name/,
  );
});

test("anonymous public tierlists expire after one month", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  assert.equal(
    isAnonymousPublicTierlistExpired(
      { siteUserId: null, publishedAt: "2026-06-23T11:59:59Z" },
      now,
    ),
    true,
  );
  assert.equal(
    isAnonymousPublicTierlistExpired(
      { siteUserId: null, publishedAt: "2026-07-01T12:00:00Z" },
      now,
    ),
    false,
  );
  assert.equal(
    isAnonymousPublicTierlistExpired(
      { siteUserId: 7, publishedAt: "2026-06-01T12:00:00Z" },
      now,
    ),
    false,
  );
});

test("tierlist deletion is limited to author or admin roles", () => {
  const row = { siteUserId: 7 };

  assert.equal(userCanDeleteStreamerTierlist({ id: 7, roles: ["streamer"] }, row), true);
  assert.equal(userCanDeleteStreamerTierlist({ id: 8, roles: ["streamer"] }, row), false);
  assert.equal(userCanDeleteStreamerTierlist({ id: 8, roles: ["admin"] }, row), true);
  assert.equal(userCanDeleteStreamerTierlist({ id: 8, roles: ["owner"] }, row), true);
  assert.equal(userCanDeleteStreamerTierlist({ id: 8, roles: ["user"] }, { siteUserId: null }), false);
});

test("sanitizeStreamerTierlistSubmission keeps known champions and dedupes them per lane", () => {
  const championMap = new Map([
    [
      "ahri",
      {
        slug: "ahri",
        name: "Ahri",
        iconUrl: "/wr-api/icons/ahri",
        roles: ["mid"],
      },
    ],
    [
      "lulu",
      {
        slug: "lulu",
        name: "Lulu",
        iconUrl: "/wr-api/icons/lulu",
        roles: ["support"],
      },
    ],
  ]);

  const payload = sanitizeStreamerTierlistSubmission(
    {
      lanes: {
        mid: {
          "S+": ["ahri", "ahri", "missing"],
          A: ["lulu"],
        },
        support: {
          S: ["lulu"],
        },
      },
    },
    championMap,
  );

  assert.deepEqual(payload.tiersOrder, STREAMER_TIERLIST_TIERS);
  assert.deepEqual(Object.keys(payload.lanes), STREAMER_TIERLIST_LANE_KEYS);
  assert.deepEqual(payload.lanes.mid.tiers["S+"].map((item) => item.slug), ["ahri"]);
  assert.deepEqual(payload.lanes.mid.tiers.A.map((item) => item.slug), ["lulu"]);
  assert.deepEqual(payload.lanes.support.tiers.S.map((item) => item.slug), ["lulu"]);
  assert.equal(payload.lanes.mid.tiers.S.length, 0);
});

test("sanitizeStreamerTierlistSubmission supports one overall board without lane duplication", () => {
  const championMap = new Map([
    ["ahri", { slug: "ahri", name: "Ahri", roles: ["mid"] }],
    ["lulu", { slug: "lulu", name: "Lulu", roles: ["support"] }],
  ]);

  const payload = sanitizeStreamerTierlistSubmission(
    {
      mode: "overall",
      lanes: {
        overall: {
          "S+": ["ahri", "ahri"],
          A: ["lulu"],
        },
        mid: { S: ["lulu"] },
      },
    },
    championMap,
  );

  assert.equal(payload.mode, "overall");
  assert.deepEqual(Object.keys(payload.lanes), ["overall"]);
  assert.deepEqual(payload.lanes.overall.tiers["S+"].map((item) => item.slug), ["ahri"]);
  assert.deepEqual(payload.lanes.overall.tiers.A.map((item) => item.slug), ["lulu"]);
});

test("sanitizeStreamerTierlistSubmission keeps safe custom tier labels and colors", () => {
  const payload = sanitizeStreamerTierlistSubmission(
    {
      mode: "overall",
      lanes: { overall: {} },
      tierStyles: {
        "S+": { label: "Имба", color: "#12ABef" },
        S: { label: "", color: "red" },
      },
    },
    new Map(),
  );

  assert.deepEqual(payload.tierStyles["S+"], { label: "Имба", color: "#12abef" });
  assert.deepEqual(payload.tierStyles.S, { label: "S", color: "#f19797" });
});

test("only users with the streamer role appear in the streamer catalog", () => {
  assert.equal(siteUserCanAppearInStreamerCatalog(["streamer"]), true);
  assert.equal(siteUserCanAppearInStreamerCatalog(["owner"]), false);
  assert.equal(siteUserCanAppearInStreamerCatalog(["user"]), false);
  assert.equal(siteUserCanAppearInStreamerCatalog([]), false);
});

test("anonymous tierlist credentials expose a public id but store only the edit-token hash", () => {
  const credentials = createPublicTierlistCredentials();

  assert.match(credentials.publicId, /^[A-Za-z0-9_-]{16,}$/);
  assert.match(credentials.editToken, /^[A-Za-z0-9_-]{24,}$/);
  assert.notEqual(credentials.publicId, credentials.editToken);
  assert.equal(credentials.editTokenHash, hashPublicTierlistEditToken(credentials.editToken));
  assert.equal(verifyPublicTierlistEditToken(credentials.editToken, credentials.editTokenHash), true);
  assert.equal(verifyPublicTierlistEditToken("wrong-token", credentials.editTokenHash), false);
});
