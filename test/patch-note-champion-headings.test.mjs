import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePatchArticle } from "../lib/patchNotesParser.mjs";
import { buildPatchChangeRows } from "../lib/patchNotesChangeRecords.mjs";

const source = await readFile(new URL("./fixtures/riot-patch-notes-7.3c-champions.html", import.meta.url), "utf8");
const emptyCatalog = { champions: new Map(), items: new Map(), runes: new Map(), spells: new Map() };
const identities = [
  ["jarvan-iv", "Джарван IV"], ["taliyah", "Талия"], ["ryze", "Райз"],
  ["kayn", "Каин"], ["vladimir", "Владимир"],
];
const expectedDeltas = [
  [["105%", "100%"], ["95%", "100%"]], [["100%", "110%"]],
  [["100%", "90%"]], [["95%", "105%"]], [["90%", "100%"], ["110%", "105%"]],
];

function catalog(entries) {
  return { ...emptyCatalog, champions: new Map(entries.map(([slug, name]) => [name.toLowerCase(), { slug, name }])) };
}

function article(version, body, title = `Wild Rift Patch Notes ${version}`, articleSlug = `wild-rift-patch-notes-${version.replace(".", "-")}`) {
  const page = {
    url: `https://wildrift.leagueoflegends.com/en-us/news/game-updates/${articleSlug}/`,
    blades: [{ type: "articleMasthead", title }, { type: "articleRichText", richText: { body } }],
  };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
}

for (const [label, entries] of [["complete", identities], ["partial", identities.slice(0, 1)], ["empty", []]]) {
  test(`keeps all five Riot champion blocks distinct with a ${label} catalog`, () => {
    const parsed = parsePatchArticle(source, "7.3c", "ru-ru", catalog(entries));
    const champions = parsed.changes.filter((row) => row.entityKind === "champion");
    assert.deepEqual(champions.map((row) => row.entityName), identities.map(([, name]) => name));
    assert.deepEqual(champions.map((row) => row.details.map(({ before, after }) => [before, after])), expectedDeltas);
    assert.ok(champions.every((row) => row.details.every((detail) => !detail.component)), "a sibling champion is not an ability heading");
    const stored = buildPatchChangeRows(parsed.changes, catalog(entries), [], parsed.version)
      .filter((row) => row.entityKind === "champion");
    assert.deepEqual(stored.map((row) => row.entityName), identities.map(([, name]) => name));
    assert.deepEqual(stored.map((row) => row.details.map(({ before, after }) => [before, after])), expectedDeltas);
    assert.ok(stored.every((row) => row.changeName === null));
  });
}

test("uses heading structure for unfamiliar names, versions and skipped heading levels", () => {
  const names = ["Alpha", "Beta", "Gamma", "Delta", "Omega"];
  for (const version of ["3.4", "9.9z"]) {
    for (const level of [3, 4, 5, 6]) {
      const body = `<h2>CHAMPION CHANGES</h2>${names.map((name, index) => (
        `<h${level}>${name}</h${level}><ul><li>Damage dealt: ${100 + index}% → ${110 + index}%</li></ul>`
      )).join("")}`;
      const champions = parsePatchArticle(article(version, body), version, "en-us", emptyCatalog).changes;
      assert.deepEqual(champions.map((row) => row.entityName), names, `${version}, h${level}`);
      assert.ok(champions.every((row) => row.details.length === 1 && !row.scope));
    }
  }
});

test("keeps nested ability headings inside their champion when a sibling is missing from the catalog", () => {
  const body = `<h2>CHAMPION CHANGES</h2>
    <h3>Alpha</h3><h4>First ability</h4><ul><li>Damage: 10 → 20</li></ul>
    <h3>Beta</h3><h4>Second ability</h4><ul><li>Damage: 30 → 40</li></ul>`;
  for (const entries of [[], [["alpha", "Alpha"]]]) {
    const rows = parsePatchArticle(article("9.9z", body), "9.9z", "en-us", catalog(entries)).changes;
    assert.deepEqual(rows.map((row) => row.entityName), ["Alpha", "Beta"]);
    assert.deepEqual(rows.map((row) => row.details.map((detail) => detail.after)), [["20"], ["40"]]);
    assert.deepEqual(rows.map((row) => row.details[0].component), ["First ability", "Second ability"]);
  }
});

