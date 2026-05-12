import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://local:local@127.0.0.1:5432/local";

const {
  sanitizeStreamerTierlistSubmission,
  STREAMER_TIERLIST_LANE_KEYS,
  STREAMER_TIERLIST_TIERS,
} = await import("../lib/streamerTierlists.mjs");

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
