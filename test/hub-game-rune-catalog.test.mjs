import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameRuneCatalog } from "../lib/hubGameRuneCatalog.mjs";

const sourceUrl = "https://hub-game.com/wildrift/en/runes";
const fixture = await readFile(new URL("./fixtures/hub-game-runes.html", import.meta.url), "utf8");

test("parses all rune cards and records the current snapshot provenance", () => {
  const catalog = parseHubGameRuneCatalog(fixture, sourceUrl);

  assert.equal(catalog.source.kind, "hub-game");
  assert.equal(catalog.source.url, sourceUrl);
  assert.equal(catalog.source.locale, "en");
  assert.deepEqual(catalog.source.snapshot, {
    version: "7.3b",
    updatedAt: "2026-10-16",
    translatedFromJapanese: true,
  });
  assert.equal(catalog.count, 54);
  assert.equal(catalog.runes.length, 54);
  assert.equal(new Set(catalog.runes.map((rune) => rune.slug)).size, 54);

  const comet = catalog.runes.find((rune) => rune.name === "Arcane Comet");
  assert.deepEqual(comet, {
    slug: "arcane-comet",
    slugSource: "icon-filename",
    name: "Arcane Comet",
    path: "Sorcery",
    category: "Keystone",
    image: "https://hub-game.com/wildrift/images/runes/webp/arcane_comet.webp",
    description: "Damaging a champion with an ability hurls a comet at their location. Each comet that hits an enemy champion increases the damage of the next one.",
    values: [
      { label: "Damage", value: "15 - 100 (+2 per total hit on enemy champions) (+10% bonus AD, +5% AP)" },
      { label: "Cooldown", value: "16 - 8 seconds (by level)" },
    ],
    effectText: "Damaging a champion with an ability hurls a comet at their location. Each comet that hits an enemy champion increases the damage of the next one. Damage: 15 - 100 (+2 per total hit on enemy champions) (+10% bonus AD, +5% AP) Cooldown: 16 - 8 seconds (by level)",
  });
  assert.equal(catalog.runes.find((rune) => rune.name === "Absolute Focus").category, "Minor");
});

test("rejects invalid source identity, incomplete metadata, and incomplete card sets", () => {
  assert.throws(() => parseHubGameRuneCatalog(fixture, "https://example.com/wildrift/en/runes"), /Hub Game domain/);
  assert.throws(() => parseHubGameRuneCatalog(fixture, "https://hub-game.com/wildrift/en/items"), /rune catalog/);
  assert.throws(() => parseHubGameRuneCatalog(fixture.replace("<h1>Runes List</h1>", "<h1>Not runes</h1>"), sourceUrl), /heading/);
  assert.throws(() => parseHubGameRuneCatalog(fixture.replace("Asc54 of 54 runes", "Asc53 of 53 runes"), sourceUrl), /count mismatch/);
});
