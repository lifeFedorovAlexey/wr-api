import test from "node:test";
import assert from "node:assert/strict";

import { parseTencentHeroDetail, parseTencentHeroList } from "../lib/tencentHeroLibrary.mjs";

const heroListFixture = {
  heroList: {
    "90001": {
      heroId: "90001",
      name: "Test Hero",
      title: "Test Title",
      roles: ["fighter"],
      lane: "solo",
      avatar: "https://cdn.example.test/hero.png",
      difficultyL: "2",
      damage: "3",
      surviveL: "1",
      assistL: "2",
      highlightprice: "5500",
      couponprice: "450",
    },
  },
  version: "test-version",
  fileName: "hero_list.js",
  fileTime: "2026-01-02 03:04:05",
};

const heroDetailFixture = {
  hero: {
    heroId: "90001",
    name: "Test Hero",
    title: "Test Title",
    roles: ["fighter"],
    lane: "solo",
    attack: "640000",
    attackperlevel: "55000",
    hp: "6900000",
    hpperlevel: "1280000",
    armor: "440000",
    armorperlevel: "50000",
    spellblock: "380000",
    attackspeed: "2800",
    growthfix1: "7400",
    growthfix2: "7800",
  },
  spells: [
    {
      heroId: "90001",
      spellId: "9000101",
      spellKey: "active",
      name: "Test Ability",
      description: "Test description",
      abilityIconPath: "https://cdn.example.test/ability.png",
      cdtime: "9",
      costtype: "mana",
      costvalue: "0",
      detail: ["Rank one text", "Rank two text", "Rank three text"],
      variTypeNum: "3",
      variType1: "cd",
      variValue1: "9/8/7",
      variType2: "damage",
      variValue2: "40/80/120",
      variType3: "None",
      variValue3: "0/0/0",
    },
  ],
  version: "test-version",
  fileName: "90001.js",
  fileTime: "2026-01-02 03:04:05",
};

test("parses roster envelopes, metadata, and source hero values without mutating payload", () => {
  const original = structuredClone(heroListFixture);
  const parsed = parseTencentHeroList(heroListFixture);

  assert.equal(parsed.source, "tencent-qq-wild-rift-hero-library");
  assert.equal(parsed.sourceUrl, "https://game.gtimg.cn/images/lgamem/act/lrlib/js/heroList/hero_list.js");
  assert.equal(parsed.version, "test-version");
  assert.equal(parsed.fileName, "hero_list.js");
  assert.equal(parsed.fileTime, "2026-01-02 03:04:05");
  assert.deepEqual(parsed.provenance, {
    source: "tencent-qq-wild-rift-hero-library",
    sourceUrl: "https://game.gtimg.cn/images/lgamem/act/lrlib/js/heroList/hero_list.js",
    version: "test-version",
    fileName: "hero_list.js",
    fileTime: "2026-01-02 03:04:05",
  });
  assert.equal(parsed.heroes.length, 1);
  assert.equal(parsed.heroes[0].heroId, "90001");
  assert.equal(parsed.heroes[0].name, "Test Hero");
  assert.deepEqual(parsed.heroes[0].roles, ["fighter"]);
  assert.equal(parsed.heroes[0].difficulty, 2);
  assert.equal(parsed.heroes[0].avatarUrl, "https://cdn.example.test/hero.png");
  assert.equal(parsed.heroes[0].prices.highlight, 5500);
  assert.equal(parsed.heroes[0].rawPayload, heroListFixture.heroList["90001"]);
  assert.deepEqual(heroListFixture, original);
  assert.equal(parsed.rawPayload, heroListFixture);
});

test("normalizes fixed-point stats and rank-indexed spell values with provenance", () => {
  const parsed = parseTencentHeroDetail(heroDetailFixture, { sourceUrl: "https://source.example.test/hero/90001.js" });

  assert.equal(parsed.sourceUrl, "https://source.example.test/hero/90001.js");
  assert.equal(parsed.version, "test-version");
  assert.equal(parsed.fileTime, "2026-01-02 03:04:05");
  assert.equal(parsed.hero.heroId, "90001");
  assert.equal(parsed.hero.stats.attack, 64);
  assert.equal(parsed.hero.stats.attackPerLevel, 5.5);
  assert.equal(parsed.hero.stats.health, 690);
  assert.equal(parsed.hero.stats.armor, 44);
  assert.equal(parsed.hero.stats.attackSpeed, 0.28);
  assert.deepEqual(parsed.hero.growthByLevel, [
    { level: 1, multiplier: 0.74 },
    { level: 2, multiplier: 0.78 },
  ]);

  const spell = parsed.spells[0];
  assert.equal(spell.key, "active");
  assert.deepEqual(spell.variables, [
    { name: "cd", valuesByRank: ["9", "8", "7"] },
    { name: "damage", valuesByRank: ["40", "80", "120"] },
  ]);
  assert.deepEqual(spell.levels, [
    { rank: 1, description: "Rank one text", variables: { cd: "9", damage: "40" } },
    { rank: 2, description: "Rank two text", variables: { cd: "8", damage: "80" } },
    { rank: 3, description: "Rank three text", variables: { cd: "7", damage: "120" } },
  ]);
  assert.equal(spell.rawPayload, heroDetailFixture.spells[0]);
  assert.equal(parsed.rawPayload, heroDetailFixture);
});

test("accepts the legacy hero-array roster shape and rejects malformed or mismatched data", () => {
  const parsed = parseTencentHeroList({ hero: [heroListFixture.heroList["90001"]] });
  assert.equal(parsed.heroes[0].heroId, "90001");

  assert.throws(() => parseTencentHeroList({ heroList: {} }), /roster is empty/);
  assert.throws(() => parseTencentHeroList({ heroList: { bad: { name: "No ID" } } }), /heroId/);
  assert.throws(() => parseTencentHeroDetail({ hero: { heroId: "90001", name: "Test" }, spells: [null] }), /spells\[0\]/);
  assert.throws(() => parseTencentHeroDetail({
    hero: { heroId: "90001", name: "Test" },
    spells: [{ heroId: "other", name: "Ability" }],
  }), /belongs to hero other/);
});
