import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicChampionSlugSet,
  filterChampionsForPublicPool,
  isChampionInPublicPool,
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
        en_us: null,
        zh_cn: "奎桑提",
      },
    },
  ];

  assert.deepEqual(
    filterChampionsForPublicPool(rows).map((row) => row.slug),
    ["shen"],
  );
  assert.deepEqual(Array.from(buildPublicChampionSlugSet(rows)), ["shen"]);
});
