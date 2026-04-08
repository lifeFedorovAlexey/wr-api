import test from "node:test";
import assert from "node:assert/strict";

import {
  RIFT_SECTION_REPORTS,
  buildSourceRiftPayload,
  computeSectionComparison,
  extractRiftSectionComparisonData,
} from "../scripts/audit-guides-ui-e2e.mjs";

test("buildSourceRiftPayload keeps only the latest build snapshot and applies API sort order", () => {
  const payload = buildSourceRiftPayload({
    matchups: [],
    builds: [
      {
        rank: "diamond_plus",
        lane: "top",
        buildType: "spells",
        dataDate: "2026-04-04",
        entrySlugs: ["flash", "ghost"],
        winRate: 56.1,
        pickRate: 12.4,
        winRateRank: 1,
        pickRateRank: 2,
      },
      {
        rank: "diamond_plus",
        lane: "top",
        buildType: "spells",
        dataDate: "2026-04-05",
        entrySlugs: ["flash", "barrier"],
        winRate: 57.3,
        pickRate: 18.2,
        winRateRank: 2,
        pickRateRank: 1,
      },
      {
        rank: "diamond_plus",
        lane: "top",
        buildType: "spells",
        dataDate: "2026-04-05",
        entrySlugs: ["cleanse", "flash"],
        winRate: 58.9,
        pickRate: 10.1,
        winRateRank: 1,
        pickRateRank: 3,
      },
    ],
    dictionaries: [
      { kind: "spell", slug: "flash", name: "Flash" },
      { kind: "spell", slug: "barrier", name: "Barrier" },
      { kind: "spell", slug: "cleanse", name: "Cleanse" },
      { kind: "spell", slug: "ghost", name: "Ghost" },
    ],
  });

  const section = extractRiftSectionComparisonData(payload, "diamond_plus", "top", "spells");

  assert.equal(section.totalCount, 2);
  assert.deepEqual(section.visibleSignatureList, [
    "cleanse|flash",
    "flash|barrier",
  ]);
  assert.deepEqual(section.visibleNames.slice(0, 4), [
    "Cleanse",
    "Flash",
    "Flash",
    "Barrier",
  ]);
});

test("computeSectionComparison accepts matchup entries that are rendered without guide links", () => {
  const report = RIFT_SECTION_REPORTS.find((item) => item.key === "matchups");
  const sourcePayload = buildSourceRiftPayload({
    matchups: [
      {
        rank: "diamond_plus",
        lane: "top",
        dataDate: "2026-04-05",
        opponentSlug: "mordekaiser",
        winRate: 54.7,
        pickRate: 2.1,
        winRateRank: 1,
        pickRateRank: 2,
      },
      {
        rank: "diamond_plus",
        lane: "top",
        dataDate: "2026-04-05",
        opponentSlug: "dr-mundo",
        winRate: 53.9,
        pickRate: 1.8,
        winRateRank: 2,
        pickRateRank: 3,
      },
    ],
    builds: [],
    dictionaries: [],
  });
  const sitePayload = {
    matchups: [
      {
        rank: "diamond_plus",
        lane: "top",
        dataDate: "2026-04-05",
        entries: [
          {
            opponentSlug: "mordekaiser",
            opponent: { slug: "mordekaiser", name: "Mordekaiser" },
          },
          {
            opponentSlug: "dr-mundo",
            opponent: { slug: "dr-mundo", name: "Dr. Mundo" },
          },
        ],
      },
    ],
  };

  const comparison = computeSectionComparison({
    report,
    snapshot: {
      visibleEntryCount: 2,
      totalCount: 2,
      linkedGuideSlugs: ["mordekaiser"],
      matchupNames: ["Mordekaiser", "Dr. Mundo"],
    },
    expected: extractRiftSectionComparisonData(sourcePayload, "diamond_plus", "top", "matchups"),
    siteSection: extractRiftSectionComparisonData(sitePayload, "diamond_plus", "top", "matchups"),
  });

  assert.equal(comparison.ok, true);
  assert.equal(comparison.status, "match");
});
