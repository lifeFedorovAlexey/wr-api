import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameItemDetail } from "../lib/hubGameItemDetail.mjs";

const warmogUrl = "https://hub-game.com/wildrift/en/items/warmogs-armor";
const noHistoryUrl = "https://hub-game.com/wildrift/en/items/example-item";
const warmogFixture = await readFile(new URL("./fixtures/hub-game-warmogs-detail.html", import.meta.url), "utf8");
const noHistoryFixture = await readFile(new URL("./fixtures/hub-game-item-no-history.html", import.meta.url), "utf8");

test("parses current Hub item snapshot and preserves explicitly shown patch deltas", () => {
  const item = parseHubGameItemDetail(warmogFixture, warmogUrl);

  assert.deepEqual(item.source, {
    kind: "hub-game",
    url: warmogUrl,
    locale: "en",
    snapshot: {
      version: "7.3b",
      updatedAt: "2026-10-16",
      basis: "transcribed from the game, with official patch note changes applied through patch 7.3b (updated 2026-10-16)",
    },
  });
  assert.equal(item.slug, "warmogs-armor");
  assert.equal(item.name, "Warmog's Armor");
  assert.equal(item.image, "https://hub-game.com/wildrift/images/items/webp/wr_ocr_146.webp");
  assert.equal(item.cost, 2850);
  assert.deepEqual(item.stats, ["+700 Max Health", "+100% Health Regen", "+20 Ability Haste"]);
  assert.equal(item.effects.length, 2);
  assert.deepEqual(item.history, [{
    patch: "7.3b",
    category: "Nerf",
    changes: [{ group: "Warmog's Heart", label: "Trigger threshold", before: "900", after: "1250" }],
  }]);
  assert.equal(item.historyCoverage, "partial-or-absent");
});

test("leaves unavailable history empty and only classifies explicitly marked effect kinds", () => {
  const item = parseHubGameItemDetail(noHistoryFixture, noHistoryUrl);

  assert.deepEqual(item.history, []);
  assert.deepEqual(item.passives, [{
    name: "Passive: Example Might",
    description: "Deals bonus damage.",
    type: "passive",
  }]);
  assert.deepEqual(item.actives, []);
  assert.equal(item.source.snapshot.version, null);
  assert.equal(item.source.snapshot.updatedAt, null);
});

test("rejects wrong page identity and non-Hub source URLs", () => {
  assert.throws(() => parseHubGameItemDetail(warmogFixture, "https://hub-game.com/wildrift/en/items/infinity-orb"), /canonical URL/);
  assert.throws(() => parseHubGameItemDetail(warmogFixture, "https://example.com/wildrift/en/items/warmogs-armor"), /Hub Game domain/);
  assert.throws(() => parseHubGameItemDetail(warmogFixture, "https://hub-game.com/wildrift/en/items"), /item detail page/);
});
