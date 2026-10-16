import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameItemCatalog } from "../lib/hubGameItemCatalog.mjs";

const sourceUrl = "https://hub-game.com/wildrift/en/items";
const fixture = await readFile(new URL("./fixtures/hub-game-items.html", import.meta.url), "utf8");

test("parses SSR item cards and retains primary source provenance", () => {
  const catalog = parseHubGameItemCatalog(fixture, sourceUrl);

  assert.equal(catalog.sourceKind, "hub-game-item-catalog");
  assert.equal(catalog.sourceUrl, sourceUrl);
  assert.equal(catalog.version, "9.0");
  assert.equal(catalog.date, "2026-10-16");
  assert.equal(catalog.count, 2);
  assert.deepEqual(catalog.items[0], {
    slug: "infinity-orb",
    name: "Infinity Orb",
    image: "https://hub-game.com/wildrift/images/items/webp/item_one.webp",
    cost: 3100,
    stats: ["+110 Ability Power", "+15 Magic Penetration"],
    passives: [{
      type: "Passive",
      name: "Inevitable Demise",
      description: "Abilities critically strike low-health enemies.",
    }],
  });
  assert.deepEqual(catalog.items[1].passives, [{
    type: "Active",
    name: "Example Strike",
    description: "Deals damage to the target.",
  }]);
});

test("rejects pages without source identity or matching item count", () => {
  assert.throws(() => parseHubGameItemCatalog("<html><h1>Not items</h1></html>", sourceUrl), /rendered Hub Game item catalog/);
  assert.throws(() => parseHubGameItemCatalog(fixture.replace("through patch 9.0 (updated 2026-10-16)", "source metadata unavailable"), sourceUrl), /missing version, date, or item count metadata/);
  assert.throws(() => parseHubGameItemCatalog(fixture.replace("2 of 2 items", "3 of 3 items"), sourceUrl), /count mismatch/);
  assert.throws(() => parseHubGameItemCatalog(fixture, "https://example.com/items"), /Hub Game domain/);
});
