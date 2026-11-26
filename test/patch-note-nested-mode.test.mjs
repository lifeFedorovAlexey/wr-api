import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPatchArticleReadyForImport, parsePatchArticle } from "../lib/patchNotesParser.mjs";

const catalog = {
  champions: new Map([["Bard", "Бард"], ["Irelia", "Ирелия"], ["Akali", "Акали"]].flatMap(([name, russian]) => {
    const champion = { name, slug: name.toLowerCase(), nameLocalizations: { en_us: name, ru_ru: russian } };
    return [[name.toLowerCase(), champion], [russian.toLowerCase(), champion]];
  })),
  items: new Map([["edge of durand", { name: "Edge of Durand", slug: "edge-of-durand" }]]),
  runes: new Map(),
  spells: new Map([["smite", { name: "Smite", slug: "smite" }]]),
};

function article(body, version = "6.2j") {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page: {
    url: `https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-${version.replaceAll(".", "-")}/`,
    blades: [
      { type: "articleMasthead", title: `Wild Rift Patch Notes ${version}` },
      { type: "articleRichText", richText: { body } },
    ],
  } } } })}</script>`;
}

for (const level of [2, 3, 4]) {
  test(`parses a standalone mode at h${level} and ends its scope at a sibling heading`, () => {
    const parsed = parsePatchArticle(article(`
      <h1>SYSTEMS</h1><h${level}>AAA ARAM</h${level}>
      <h${level + 1}>Augment Adjustments</h${level + 1}>
      <h${level + 2}>All in Good Fun</h${level + 2}>
      <ul><li>Cooldown: 150s → 90s</li></ul>
      <h${level}>SYSTEMS</h${level}><h${level + 1}>Conservation</h${level + 1}>
      <p>Gold granted by Conservation: 40 → 30</p>
    `), "6.2j", "en-us", catalog);
    const augment = parsed.changes.find((row) => row.entityName === "All in Good Fun");
    assert.equal(augment?.entityKind, "augment");
    assert.deepEqual(augment.scope.modeSlugs, ["aaa-aram"]);
    assert.equal(augment.details[0].before, "150s");
    assert.equal(augment.details[0].after, "90s");
    const core = parsed.changes.find((row) => row.details.some((detail) => detail.text.includes("40 → 30")));
    assert.ok(core);
    assert.equal(core.scope, undefined);
    assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
  });
}

test("keeps unknown mode items separate from a preceding catalog item and nested components", () => {
  const parsed = parsePatchArticle(article(`
    <h2>RUNES</h2><h3>AAA ARAM</h3><h4>Item Adjustments</h4>
    <h5>Edge of Durand</h5><ul><li>Attack Damage: 25 → 40</li></ul>
    <h5>Uncatalogued Relic</h5><ul><li>Max Health: 900 → 1200</li></ul>
    <h6>Passive</h6><ul><li>Cooldown: 15s → 10s</li></ul>
    <h5>Uncatalogued Blade</h5><ul><li>Deactivation Range: 15 → 25</li></ul>
  `), "6.2j", "en-us", catalog);
  const items = parsed.changes.filter((row) => row.entityKind === "item");
  assert.deepEqual(items.map((row) => row.entityName), ["Edge of Durand", "Uncatalogued Relic", "Uncatalogued Blade"]);
  assert.deepEqual(items.map((row) => row.details.length), [1, 2, 1]);
  assert.ok(items.every((row) => row.scope?.modeSlugs.includes("aaa-aram")));
  assert.equal(items[1].details[1].component, "Passive");
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
});

test("recognizes champion buff and balance category headings inside a nested mode", () => {
  const parsed = parsePatchArticle(article(`
    <h2>RUNES</h2><h3>AAA ARAM</h3><h4>Season-Exclusive Champion Buffs</h4>
    <h5>Bard</h5><ul><li>Attack Range increased by 100.</li></ul>
    <h4>Champion Balance Adjustments</h4><h5>Akali</h5>
    <ul><li>Damage Taken: 70% → 80%</li></ul>
  `), "6.2j", "en-us", catalog);
  const champions = parsed.changes.filter((row) => row.entityKind === "champion");
  assert.deepEqual(champions.map((row) => row.entitySlug), ["bard", "akali"]);
  assert.ok(champions.every((row) => row.scope?.modeSlugs.includes("aaa-aram")));
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
  champions[1].details = [];
  assert.throws(() => assertPatchArticleReadyForImport(parsed), /omitted.*numeric source delta/);
});

for (const version of ["7.3f", "7.3g"]) {
  test(`retains every numeric source change from Riot ${version} nested-mode sections`, async () => {
    const html = await readFile(new URL(`./fixtures/riot-nested-mode-${version}.html`, import.meta.url), "utf8");
    const parsed = parsePatchArticle(html, version, "en-us", catalog);
    assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
    const scoped = parsed.changes.filter((row) => row.scope?.modeSlugs.includes("aaa-aram"));
    if (version === "7.3f") {
      assert.equal(scoped.filter((row) => row.entityKind === "augment").length, 12);
      assert.equal(scoped.flatMap((row) => row.details).filter((detail) => detail.before && detail.after).length, 17);
      assert.ok(!scoped.some((row) => row.entityName === "Battle Arsenal"));
    } else {
      assert.equal(scoped.filter((row) => row.entityKind === "item").length, 6);
      assert.ok(scoped.some((row) => row.entityKind === "champion" && row.entityName === "Akali"));
      assert.ok(scoped.some((row) => row.entityKind === "champion" && row.entityName === "Bard"));
      assert.equal(scoped.filter((row) => row.entityKind === "item").flatMap((row) => row.details)
        .filter((detail) => detail.before && detail.after).length, 8);
    }
  });
}

test("classifies localized seasonal buffs and champion balance adjustments from Riot's Russian article", async () => {
  const html = await readFile(new URL("./fixtures/riot-nested-mode-ru-7.3g.html", import.meta.url), "utf8");
  const parsed = assertPatchArticleReadyForImport(parsePatchArticle(html, "7.3g", "ru-ru", catalog));
  const scoped = parsed.changes.filter((row) => row.scope?.modeSlugs.includes("aaa-aram"));
  const champions = scoped.filter((row) => row.entityKind === "champion");
  assert.equal(new Set(champions.map((row) => row.entitySlug || row.entityName)).size, 15);
  assert.ok(champions.some((row) => row.entitySlug === "bard" && row.entityName === "Бард"));
  assert.ok(champions.some((row) => row.entitySlug === "akali" && row.entityName === "Акали"));
  assert.equal(scoped.filter((row) => row.entityKind === "item").length, 6);
  assert.ok(!scoped.some((row) => row.entityKind === "system" && /^(?:Акали|Бард|Ирелия)$/.test(row.entityName)));
});
