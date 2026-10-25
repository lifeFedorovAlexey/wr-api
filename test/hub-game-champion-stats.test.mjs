import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameChampionStats } from "../lib/hubGameChampionStats.mjs";

const sourceUrl = "https://hub-game.com/wildrift/en/champions/stats";
const fixture = await readFile(new URL("./fixtures/hub-game-champion-stats.html", import.meta.url), "utf8");

test("parses level-1 champion stats, ratings, and Hub source provenance", () => {
  const result = parseHubGameChampionStats(fixture, sourceUrl);

  assert.equal(result.sourceKind, "hub-game-champion-stats-baseline");
  assert.equal(result.baselineKind, "current-global-champion-stats");
  assert.equal(result.sourceUrl, sourceUrl);
  assert.equal(result.chinaLibraryPatch, "7.3");
  assert.equal(result.chinaLibraryAsOf, "2026-09-23");
  assert.equal(result.globalPatchThrough, "7.3b");
  assert.equal(result.count, 3);
  assert.deepEqual(result.champions[0], {
    slug: "aatrox",
    hubSlug: "Aatrox",
    name: "Aatrox",
    statsAtLevel1: {
      health: 630,
      mana: null,
      attack: 62,
      armor: 46,
      armorDamageReductionPercent: 32,
      magicResist: 36,
      magicDamageReductionPercent: 26,
      movementSpeed: 355,
    },
    ratings: {
      damage: { value: 3, max: 3 },
      survive: { value: 3, max: 3 },
      utility: { value: 2, max: 3 },
      difficulty: { value: 2, max: 3 },
    },
  });
  assert.equal(result.champions[1].slug, "ahri");
  assert.equal(result.champions[1].statsAtLevel1.mana, 435);
  assert.equal(result.champions[2].ratings.difficulty.value, 1);
});

test("rejects missing source metadata, incorrect row counts, and non-Hub endpoints", () => {
  assert.throws(() => parseHubGameChampionStats("<html><h1>Not stats</h1></html>", sourceUrl), /rendered Hub Game champion stats table/);
  assert.throws(() => parseHubGameChampionStats(fixture.replace("patch 7.3, as of 2026-09-23", "patch unknown"), sourceUrl), /missing source version/);
  assert.throws(() => parseHubGameChampionStats(fixture.replace("for all 3 champions", "for all 4 champions"), sourceUrl), /count mismatch/);
  assert.throws(() => parseHubGameChampionStats(fixture, "https://example.com/wildrift/en/champions/stats"), /Hub Game domain/);
  assert.throws(() => parseHubGameChampionStats(fixture, "https://hub-game.com/wildrift/en/spells"), /champion stats page/);
});

test("rejects duplicate champions, missing required values, broken links, and malformed ratings", () => {
  const duplicate = fixture.replace("href=\"/wildrift/en/champions/Garen\">Garen", "href=\"/wildrift/en/champions/Ahri\">Ahri");
  assert.throws(() => parseHubGameChampionStats(duplicate, sourceUrl), /duplicate slug/);
  assert.throws(() => parseHubGameChampionStats(fixture.replace("<td>630</td><td><span>—</span>", "<td></td><td><span>—</span>"), sourceUrl), /invalid health/);
  assert.throws(() => parseHubGameChampionStats(fixture.replace("/wildrift/en/champions/Aatrox", "/wildrift/en/items/Aatrox"), sourceUrl), /non-canonical champion link/);
  assert.throws(() => parseHubGameChampionStats(fixture.replace("Damage: 3 of 3", "Damage: high"), sourceUrl), /missing Damage rating/);
});

test("source versions exclude sentence punctuation and retain valid patch suffixes", () => {
  for (const version of ["7.3", "7.3b", "12.10z"]) {
    for (const punctuation of [".", ",", ";", ")"]) {
      const page = fixture.replace("patch 7.3, as of", `patch ${version}, as of`)
        .replace("applied up to 7.3b", `applied up to ${version}${punctuation}`);
      const parsed = parseHubGameChampionStats(page, sourceUrl);
      assert.equal(parsed.chinaLibraryPatch, version);
      assert.equal(parsed.globalPatchThrough, version, punctuation);
    }
  }
  for (const invalid of ["7..3", "7.3.4"]) {
    assert.throws(() => parseHubGameChampionStats(fixture.replace("patch 7.3, as of", `patch ${invalid}, as of`), sourceUrl), /missing source version/);
    assert.throws(() => parseHubGameChampionStats(fixture.replace("applied up to 7.3b", `applied up to ${invalid}`), sourceUrl), /missing source version/);
  }
});
