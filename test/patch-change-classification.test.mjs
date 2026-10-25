import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPatchChangeRows } from "../lib/patchNotesChangeRecords.mjs";
import { parsePatchArticle } from "../lib/patchNotesParser.mjs";

const items = [
  ["youmuu s ghostblade", "youmuus-ghostblade", "Youmuu's Ghostblade"],
  ["locket of the iron solari", "locket-enchant", "Locket of the Iron Solari"],
  ["thornmail", "thornmail", "Thornmail"],
  ["warmog s armor", "warmogs-armor", "Warmog's Armor"],
  ["statikk shiv", "statikk-shiv", "Statikk Shiv"],
  ["yun tal wildarrows", "yun-tal-wildarrows", "Yun Tal Wildarrows"],
].map(([alias, slug, name]) => [alias, { slug, name }]);

const runes = [
  ["electrocute", "electrocute", "Electrocute"],
  ["cheap shot", "cheap-shot", "Cheap Shot"],
  ["grasp of the undying", "grasp-of-the-undying", "Grasp of the Undying"],
  ["aery", "aery", "Aery"],
].map(([alias, slug, name]) => [alias, { slug, name }]);

test("classifies item costs, thresholds, stats, and rune cooldowns from change semantics", async () => {
  const fixture = await readFile(new URL("./fixtures/patch-change-classification.html", import.meta.url), "utf8");
  const page = {
    url: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-9-0/",
    blades: [
      { type: "articleMasthead", title: "Wild Rift Patch Notes 9.0" },
      { type: "articleRichText", fragmentId: "GAMEPLAY CHANGES", richText: { body: fixture } },
    ],
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page } },
  })}</script>`;
  const catalog = {
    champions: new Map(),
    items: new Map(items),
    runes: new Map(runes),
    spells: new Map(),
  };
  const parsed = parsePatchArticle(html, "9.0", "en-us", catalog);
  const rows = buildPatchChangeRows(parsed.changes, catalog, [], "9.0");

  assert.deepEqual(
    rows.filter(({ entityKind }) => entityKind === "item").map(({ entitySlug, changeType }) => [entitySlug, changeType]),
    [
      ["youmuus-ghostblade", "buff"],
      ["locket-enchant", "buff"],
      ["thornmail", "nerf"],
      ["warmogs-armor", "adjustment"],
      ["statikk-shiv", "buff"],
      ["yun-tal-wildarrows", "buff"],
    ],
  );
  assert.deepEqual(
    rows.filter(({ entityKind }) => entityKind === "rune").map(({ entitySlug, changeType }) => [entitySlug, changeType]),
    [
      ["electrocute", "buff"],
      ["cheap-shot", "buff"],
      ["grasp-of-the-undying", "nerf"],
      ["aery", "nerf"],
    ],
  );
});

test("classifies mixed stat vectors and older item markup without patch-specific rules", () => {
  const catalog = {
    champions: new Map([
      ["olaf", { slug: "olaf", name: "Olaf" }],
      ["katarina", { slug: "katarina", name: "Katarina" }],
    ]),
    items: new Map([
      ["nashor s tooth", { slug: "nashors-tooth", name: "Nashor's Tooth" }],
      ["infinity orb", { slug: "infinity-orb", name: "Infinity Orb" }],
      ["serylda s grudge", { slug: "seryldas-grudge", name: "Serylda's Grudge" }],
    ]),
    runes: new Map(),
    spells: new Map(),
  };
  const body = `
    <h2>CHAMPION CHANGES</h2><h3>Olaf</h3>
    <h4>Undertow</h4><ul><li>Damage: 50/120/190/260 + 100% Bonus Attack Damage → 50/115/180/245 + 120% Bonus Attack Damage</li></ul>
    <h4>Reckless Swing</h4><ul><li>Damage: 55/115/175/235 + 50% Attack Damage → 45/95/145/195 + 55% Attack Damage</li></ul>
    <h3>Katarina</h3><h4>Death Lotus</h4><ul><li>Base damage: 50 + 12 × Level → 40 + 10 × Level</li><li>Ability Power ratio: (45 + 3 × Level)% → (30 + 3 × Level)%</li></ul>
    <h2>GAMEPLAY CHANGES</h2><h3>ITEM ADJUSTMENTS</h3>
    <h4>Nashor's Tooth</h4><h5>Magic Fang</h5><ul><li>Gain 30 Attack Damage or 60 Ability Power (Adaptive) → Gain 25 Attack Damage or 50 Ability Power (Adaptive)</li></ul>
    <h4>Infinity Orb</h4><h5>Thunderfall</h5><ul><li>Damage: 50 ~ 85 + 20% Ability Power → 50 ~ 75 + 10% Ability Power</li></ul>
    <h4>Serylda's Grudge</h4><h5>Frostbite</h5><ul><li>Damage: 25 + 5 ~ 75 + 70% Bonus Attack Damage → 10 + 2 ~ 30 + 40% Bonus Attack Damage</li></ul>
  `;
  const page = {
    url: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-9-0/",
    blades: [
      { type: "articleMasthead", title: "Wild Rift Patch Notes 9.0" },
      { type: "articleRichText", fragmentId: "CHAMPION CHANGES", richText: { body } },
    ],
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
  const parsed = parsePatchArticle(html, "9.0", "en-us", catalog);
  const rows = buildPatchChangeRows(parsed.changes, catalog, [], "9.0");

  assert.equal(rows.find(({ entitySlug }) => entitySlug === "olaf")?.changeType, "adjustment");
  assert.equal(rows.find(({ entitySlug }) => entitySlug === "katarina")?.changeType, "nerf");
  assert.deepEqual(
    rows.filter(({ entityKind, entitySlug }) => entityKind === "item" && entitySlug)
      .map(({ entitySlug, changeType }) => [entitySlug, changeType]),
    [
      ["nashors-tooth", "nerf"],
      ["infinity-orb", "nerf"],
      ["seryldas-grudge", "nerf"],
    ],
  );
});

test("classifies older item and rune value markup and strips rune-tree prefixes", () => {
  const items = new Map([
    ["ancient coin", { slug: "ancient-coin", name: "Ancient Coin" }],
    ["duskblade of draktharr", { slug: "duskblade-of-draktharr", name: "Duskblade of Draktharr" }],
    ["magnetron enchant", { slug: "magnetron-enchant", name: "Magnetron Enchant" }],
    ["mercury s treads", { slug: "mercurys-treads", name: "Mercury's Treads" }],
  ]);
  const runes = new Map([
    ["eyeball collection", { slug: "eyeball-collector", name: "Eyeball Collector" }],
    ["ingenious hunter", { slug: "ingenious-hunter", name: "Ingenious Hunter" }],
    ["zombie ward", { slug: "zombie-ward", name: "Zombie Ward" }],
    ["hextech flashtraption", { slug: "hextech-flashtraption", name: "Hextech Flashtraption" }],
  ]);
  const body = `
    <h2>GAMEPLAY CHANGES</h2><h3>ITEM ADJUSTMENTS</h3>
    <h4>Ancient Coin</h4><h5>Unique passive - Offering</h5><ul><li>One time gold gained: 55 → 65</li><li>One time health regeneration: 15-65 → 20-80</li></ul>
    <h4>Duskblade of Draktharr</h4><h5>Unique passive - Nightstalker</h5><ul><li>Base damage: 20 to 125 (based on level) → 60 to 160 (based on level)</li><li>Slowdown time: 0.25s → 0.35s</li></ul>
    <h4>Magnetron Enchant</h4><h5>Unique passive - Magnetron</h5><ul><li>Maximum movement distance: 500 → 550</li><li>Cooldown: 60s → 50s</li></ul>
    <h4>Mercury's Treads</h4><ul><li>Maximum health: 150 → 200</li><li>Reducing magic damage by: 15% → 12%</li></ul>
    <h2>RUNE CHANGES</h2>
    <h3>DOMINATION: EYEBALL COLLECTION</h3><ul><li>Attack Damage gained from each takedown: 0.5 → 1 (Maximum 15 → 20)</li></ul>
    <h3>DOMINATION: INGENIOUS HUNTER</h3><ul><li>Item ability haste gain from each takedown 4 → 5 (Maximum 40 → 45)</li></ul>
    <h3>DOMINATION: ZOMBIE WARD</h3><ul><li>Attack Damage gained from removing ward each time: 2 → 3 (Maximum 20 → 25)</li></ul>
    <h3>INSPIRATION: HEXTECH FLASHTRAPTION</h3><ul><li>Channeling time of longer flash distance: 3s → 2s</li><li>Maintaining time for flashing to the longest distance: 3.5s → 4.5s</li></ul>
  `;
  const page = {
    url: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-9-0/",
    blades: [
      { type: "articleMasthead", title: "Wild Rift Patch Notes 9.0" },
      { type: "articleRichText", fragmentId: "GAMEPLAY CHANGES", richText: { body } },
    ],
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
  const catalog = { champions: new Map(), items, runes, spells: new Map() };
  const parsed = parsePatchArticle(html, "9.0", "en-us", catalog);
  const rows = buildPatchChangeRows(parsed.changes, catalog, [], "9.0");

  assert.deepEqual(
    rows.filter(({ entityKind, entitySlug }) => entityKind === "item" && entitySlug)
      .map(({ entitySlug, changeType }) => [entitySlug, changeType]),
    [
      ["ancient-coin", "buff"],
      ["duskblade-of-draktharr", "buff"],
      ["magnetron-enchant", "buff"],
      ["mercurys-treads", "adjustment"],
    ],
  );
  assert.deepEqual(
    rows.filter(({ entityKind }) => entityKind === "rune").map(({ entitySlug, changeType }) => [entitySlug, changeType]),
    [
      ["eyeball-collector", "buff"],
      ["ingenious-hunter", "buff"],
      ["zombie-ward", "buff"],
      ["hextech-flashtraption", "buff"],
    ],
  );
});

test("item parsing preserves mixed ranks and distinguishes execution from minimum thresholds", () => {
  const catalog = { champions: new Map(), items: new Map([
    ["threshold item", { slug: "threshold-item", name: "Threshold Item" }],
  ]), runes: new Map(), spells: new Map() };
  for (const [label, before, after, expected] of [
    ["Execute health threshold", "5%", "10%", "buff"],
    ["Execute health threshold", "10%", "5%", "nerf"],
    ["Порог здоровья для казни", "5%", "10%", "buff"],
    ["Minimum bonus health threshold", "900", "1250", "nerf"],
    ["Минимальный порог дополнительного здоровья", "1250", "900", "buff"],
    ["Trigger threshold", "900", "1250", "adjustment"],
    ["Порог срабатывания", "1250", "900", "adjustment"],
    ["Damage", "10/20", "20/15", "adjustment"],
  ]) {
    const body = `<h2>GAMEPLAY CHANGES</h2><h3>ITEM ADJUSTMENTS</h3><h4>Threshold Item</h4><ul><li>${label}: ${before} → ${after}</li></ul>`;
    const page = {
      url: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-9-0/",
      blades: [{ type: "articleMasthead", title: "Wild Rift Patch Notes 9.0" },
        { type: "articleRichText", richText: { body } }],
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
    const parsed = parsePatchArticle(html, "9.0", "en-us", catalog);
    const [row] = buildPatchChangeRows(parsed.changes, catalog, [], "9.0");
    assert.equal(row.changeType, expected, `${label}: ${before} → ${after}`);
  }
});
