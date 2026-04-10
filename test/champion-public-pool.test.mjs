import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicChampionSlugSet,
  filterChampionsForPublicPool,
  getChampionPublicPoolStatus,
  isChampionInPublicPool,
  summarizeChampionPublicPool,
} from "../lib/championPublicPool.mjs";

test("isChampionInPublicPool keeps champions with riot ru and en names", () => {
  assert.equal(
    isChampionInPublicPool({
      slug: "shen",
      nameLocalizations: {
        ru_ru: "Шен",
        en_us: "Shen",
        zh_cn: "慎",
      },
    }),
    true,
  );
});

test("isChampionInPublicPool keeps temporary en-only Riot champions", () => {
  assert.equal(
    isChampionInPublicPool({
      slug: "ksante",
      nameLocalizations: {
        ru_ru: null,
        en_us: "K'Sante",
        zh_cn: "奎桑提",
      },
    }),
    true,
  );
});

test("isChampionInPublicPool excludes cn-only champions outside main pool", () => {
  assert.equal(
    isChampionInPublicPool({
      slug: "ksante",
      nameLocalizations: {
        ru_ru: null,
        en_us: null,
        zh_cn: "奎桑提",
      },
    }),
    false,
  );
});

test("public pool helpers only keep supported champion slugs", () => {
  const rows = [
    {
      slug: "shen",
      nameLocalizations: {
        ru_ru: "Шен",
        en_us: "Shen",
      },
    },
    {
      slug: "ksante",
      nameLocalizations: {
        ru_ru: null,
        en_us: "K'Sante",
        zh_cn: "奎桑提",
      },
    },
    {
      slug: "unknown-cn-only",
      nameLocalizations: {
        ru_ru: null,
        en_us: null,
        zh_cn: "奎桑提",
      },
    },
  ];

  assert.deepEqual(
    filterChampionsForPublicPool(rows).map((row) => row.slug),
    ["shen", "ksante"],
  );
  assert.deepEqual(Array.from(buildPublicChampionSlugSet(rows)), ["shen", "ksante"]);
});

test("getChampionPublicPoolStatus classifies temporary en-only Riot champions", () => {
  assert.deepEqual(
    getChampionPublicPoolStatus({
      slug: "ksante",
      nameLocalizations: {
        ru_ru: null,
        en_us: "K'Sante",
        zh_cn: "奎桑提",
      },
    }),
    {
      isPublic: true,
      isTemporaryEnOnly: true,
      reason: "riot-en-only-temporary",
    },
  );
});

test("summarizeChampionPublicPool reports temporary en-only and excluded samples", () => {
  const summary = summarizeChampionPublicPool([
    {
      slug: "shen",
      nameLocalizations: {
        ru_ru: "Шен",
        en_us: "Shen",
      },
    },
    {
      slug: "ksante",
      nameLocalizations: {
        ru_ru: null,
        en_us: "K'Sante",
      },
    },
    {
      slug: "unknown-cn-only",
      nameLocalizations: {
        ru_ru: null,
        en_us: null,
        zh_cn: "未知",
      },
    },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    public: 2,
    temporaryEnOnly: 1,
    excluded: 1,
    temporaryEnOnlySlugs: ["ksante"],
    excludedSlugs: ["unknown-cn-only"],
  });
});
