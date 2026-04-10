import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChampionCatalogFromSources,
  buildRiotChampionCatalog,
} from "../lib/championCatalogSync.mjs";

test("buildRiotChampionCatalog adds en-only Riot champions when en-us is ahead", () => {
  const { riotNames, diagnostics } = buildRiotChampionCatalog({
    ruNames: new Map([["ahri", { ru_ru: "Ари" }]]),
    enNames: new Map([
      ["ahri", { en_us: "Ahri" }],
      ["ksante", { en_us: "K'Sante" }],
    ]),
  });

  assert.deepEqual(Array.from(riotNames.keys()), ["ahri", "ksante"]);
  assert.deepEqual(riotNames.get("ksante"), {
    ru_ru: null,
    en_us: "K'Sante",
  });
  assert.deepEqual(diagnostics.addedFromEnOnly, ["ksante"]);
});

test("buildChampionCatalogFromSources keeps Riot page as the only champion base", () => {
  const riotNames = new Map([
    ["ahri", { ru_ru: "Ари", en_us: "Ahri" }],
    ["xin-zhao", { ru_ru: "Син Чжао", en_us: "Xin Zhao" }],
  ]);

  const cnChampions = [
    {
      slug: "ahri",
      cnHeroId: "1",
      names: { zh_cn: "阿狸" },
      roles: ["mage"],
      difficulty: "medium",
      icon: "ahri.png",
    },
    {
      slug: "xinzhao",
      cnHeroId: "2",
      names: { zh_cn: "赵信" },
      roles: ["fighter"],
      difficulty: "easy",
      icon: "xin.png",
    },
    {
      slug: "ksante",
      cnHeroId: "999",
      names: { zh_cn: "奎桑提" },
      roles: ["tank"],
      difficulty: "hard",
      icon: "ksante.png",
    },
  ];

  const { champions, diagnostics } = buildChampionCatalogFromSources({
    riotNames,
    cnChampions,
  });

  assert.deepEqual(
    champions.map((champion) => champion.slug),
    ["ahri", "xin-zhao"],
  );
  assert.equal(champions[0].names.zh_cn, "阿狸");
  assert.equal(champions[1].cnHeroId, "2");
  assert.deepEqual(diagnostics.excludedCnOnly, [
    { cnSlug: "ksante", riotSlug: "ksante" },
  ]);
});

test("buildChampionCatalogFromSources keeps Riot champion when CN enrichment is missing", () => {
  const riotNames = new Map([["lux", { ru_ru: "Люкс", en_us: "Lux" }]]);

  const { champions, diagnostics } = buildChampionCatalogFromSources({
    riotNames,
    cnChampions: [],
  });

  assert.equal(champions.length, 1);
  assert.equal(champions[0].slug, "lux");
  assert.equal(champions[0].cnHeroId, null);
  assert.deepEqual(diagnostics.missingCnDetails, ["lux"]);
});

test("buildChampionCatalogFromSources keeps en-only Riot champion until ru page catches up", () => {
  const riotNames = new Map([["ksante", { ru_ru: null, en_us: "K'Sante" }]]);
  const cnChampions = [
    {
      slug: "ksante",
      cnHeroId: "999",
      names: { zh_cn: "奎桑提" },
      roles: ["tank"],
      difficulty: "hard",
      icon: "ksante.png",
    },
  ];

  const { champions } = buildChampionCatalogFromSources({
    riotNames,
    cnChampions,
  });

  assert.deepEqual(champions[0].names, {
    ru_ru: null,
    en_us: "K'Sante",
    zh_cn: "奎桑提",
  });
});
