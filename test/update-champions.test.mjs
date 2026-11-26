import test from "node:test";
import assert from "node:assert/strict";

import { mergeScrapedChampionWithExistingRow } from "../lib/championScrapeMerge.mjs";

test("mergeScrapedChampionWithExistingRow preserves existing CN enrichment when scrape is partial", () => {
  const merged = mergeScrapedChampionWithExistingRow(
    {
      slug: "ahri",
      cnHeroId: null,
      names: {
        ru_ru: "Ари",
        en_us: "Ahri",
        zh_cn: null,
      },
      roles: [],
      difficulty: null,
      icon: null,
      rolesLocalized: {
        ru_ru: [],
        en_us: [],
        zh_cn: [],
      },
      difficultyLocalized: {
        ru_ru: null,
        en_us: null,
        zh_cn: null,
      },
    },
    {
      slug: "ahri",
      cnHeroId: "1",
      nameLocalizations: {
        ru_ru: "Ари",
        en_us: "Ahri",
        zh_cn: "阿狸",
      },
      roles: ["mage"],
      rolesLocalizations: {
        ru_ru: ["Маг"],
        en_us: ["Mage"],
        zh_cn: ["法师"],
      },
      difficulty: "medium",
      difficultyLocalizations: {
        ru_ru: "Средняя",
        en_us: "Medium",
        zh_cn: "中等",
      },
      icon: "ahri.png",
    },
  );

  assert.equal(merged.cnHeroId, "1");
  assert.equal(merged.names.zh_cn, "阿狸");
  assert.deepEqual(merged.roles, ["mage"]);
  assert.equal(merged.difficulty, "medium");
  assert.equal(merged.icon, "ahri.png");
  assert.deepEqual(merged.rolesLocalized.zh_cn, ["法师"]);
  assert.equal(merged.difficultyLocalized.en_us, "Medium");
});

test("mergeScrapedChampionWithExistingRow prefers fresh scrape data when available", () => {
  const merged = mergeScrapedChampionWithExistingRow(
    {
      slug: "xin-zhao",
      cnHeroId: "2",
      names: {
        ru_ru: "Син Чжао",
        en_us: "Xin Zhao",
        zh_cn: "赵信",
      },
      roles: ["fighter"],
      difficulty: "easy",
      icon: "xin-new.png",
      rolesLocalized: {
        ru_ru: ["Боец"],
        en_us: ["Fighter"],
        zh_cn: ["战士"],
      },
      difficultyLocalized: {
        ru_ru: "Лёгкая",
        en_us: "Easy",
        zh_cn: "简单",
      },
    },
    {
      slug: "xin-zhao",
      cnHeroId: "old-id",
      nameLocalizations: {
        ru_ru: "Син Чжао",
        en_us: "Xin Zhao",
        zh_cn: "旧赵信",
      },
      roles: ["tank"],
      rolesLocalizations: {
        ru_ru: ["Танк"],
        en_us: ["Tank"],
        zh_cn: ["坦克"],
      },
      difficulty: "hard",
      difficultyLocalizations: {
        ru_ru: "Сложная",
        en_us: "Hard",
        zh_cn: "困难",
      },
      icon: "xin-old.png",
    },
  );

  assert.equal(merged.cnHeroId, "2");
  assert.equal(merged.names.zh_cn, "赵信");
  assert.deepEqual(merged.roles, ["fighter"]);
  assert.equal(merged.difficulty, "easy");
  assert.equal(merged.icon, "xin-new.png");
  assert.deepEqual(merged.rolesLocalized.en_us, ["Fighter"]);
  assert.equal(merged.difficultyLocalized.ru_ru, "Лёгкая");
});
