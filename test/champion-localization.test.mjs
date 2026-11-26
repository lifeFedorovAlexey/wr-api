import test from "node:test";
import assert from "node:assert/strict";

import { resolveChampionLocalizedName } from "../lib/championLocalization.mjs";

test("resolveChampionLocalizedName uses override for broken K'Sante ru localization", () => {
  assert.equal(
    resolveChampionLocalizedName({
      slug: "ksante",
      lang: "ru_ru",
      nameLocalizations: {
        ru_ru: "奎桑提",
        en_us: "K'Sante",
      },
      fallbackName: "奎桑提",
    }),
    "К'Санте",
  );
});

test("resolveChampionLocalizedName applies official Russian names missing from the Hub catalog", () => {
  const officialNames = new Map([
    ["chogath", "Чо'Гат"],
    ["hwei", "Хвэй"],
    ["skarner", "Скарнер"],
    ["taliyah", "Талия"],
    ["yunara", "Юнара"],
  ]);

  for (const [slug, expected] of officialNames) {
    assert.equal(
      resolveChampionLocalizedName({
        slug,
        lang: "ru_ru",
        nameLocalizations: { en_us: slug },
        fallbackName: slug,
      }),
      expected,
      slug,
    );
  }
});

test("resolveChampionLocalizedName falls back to english when requested localization is cjk", () => {
  assert.equal(
    resolveChampionLocalizedName({
      slug: "testchamp",
      lang: "ru_ru",
      nameLocalizations: {
        ru_ru: "测试英雄",
        en_us: "Test Champion",
      },
      fallbackName: "测试英雄",
    }),
    "Test Champion",
  );
});

test("resolveChampionLocalizedName keeps requested non-cjk localization", () => {
  assert.equal(
    resolveChampionLocalizedName({
      slug: "shen",
      lang: "ru_ru",
      nameLocalizations: {
        ru_ru: "Шен",
        en_us: "Shen",
      },
      fallbackName: "Shen",
    }),
    "Шен",
  );
});
