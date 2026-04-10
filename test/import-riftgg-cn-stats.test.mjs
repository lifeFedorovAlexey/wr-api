import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRiftGgImportPlan,
  buildRiftGgImportReport,
} from "../scripts/import-riftgg-cn-stats.mjs";

test("buildRiftGgImportPlan keeps temporary en-only Riot champions in the import set", () => {
  const plan = buildRiftGgImportPlan({
    championRows: [
      {
        slug: "ahri",
        nameLocalizations: {
          ru_ru: "Ари",
          en_us: "Ahri",
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
    ],
    requestedSlugs: [],
  });

  assert.deepEqual(plan.slugs, ["ahri", "ksante"]);
  assert.equal(plan.poolSummary.temporaryEnOnly, 1);
  assert.equal(plan.filteredOutCount, 1);
});

test("buildRiftGgImportPlan reports missing and excluded requested slugs", () => {
  const plan = buildRiftGgImportPlan({
    championRows: [
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
    ],
    requestedSlugs: ["ksante", "unknown-cn-only", "mel"],
  });

  assert.deepEqual(plan.missingRequestedSlugs, ["mel"]);
  assert.deepEqual(plan.excludedRequestedSlugs, ["unknown-cn-only"]);
});

test("buildRiftGgImportReport keeps plan and execution summary compact", () => {
  const plan = {
    requestedSlugs: ["ahri"],
    slugs: ["ahri", "ksante"],
    poolSummary: {
      temporaryEnOnly: 1,
    },
    filteredOutCount: 2,
    missingRequestedSlugs: ["mel"],
    excludedRequestedSlugs: ["unknown-cn-only"],
  };
  const execution = {
    uploaded: [{ slug: "ahri" }],
    skipped: [{ slug: "ksante", reason: "page-not-found" }],
    failed: [],
  };
  const itemAssetSummary = {
    mirrored: 4,
    failed: 1,
  };

  assert.deepEqual(
    buildRiftGgImportReport({
      plan,
      execution,
      itemAssetSummary,
    }),
    {
      requested: 1,
      total: 2,
      uploaded: 1,
      skipped: 1,
      failed: 0,
      temporaryEnOnly: 1,
      excludedNonPublic: 2,
      missingRequestedSlugs: ["mel"],
      excludedRequestedSlugs: ["unknown-cn-only"],
      itemAssets: {
        mirrored: 4,
        failed: 1,
      },
    },
  );
});
