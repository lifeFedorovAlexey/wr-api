import test from "node:test";
import assert from "node:assert/strict";

import { buildGuidesAuditReport } from "../lib/guidesAuditStore.mjs";

test("buildGuidesAuditReport aggregates champion failures for dashboard widgets", () => {
  const report = buildGuidesAuditReport(
    {
      id: "run-1",
      scope: "single",
      slug: "kalista",
      startedAt: "2026-04-08T18:00:00.000Z",
    },
    {
      startedAt: "2026-04-08T18:00:00.000Z",
      finishedAt: "2026-04-08T18:05:00.000Z",
      passed: 0,
      failed: 1,
      results: [
        {
          slug: "kalista",
          ok: false,
          checkedCombos: ["diamond_plus::top", "master_plus::adc"],
          expectedWrfVariants: 0,
          issues: [
            { section: "riftgg", message: "UI section is missing", title: "Матчапы" },
          ],
          comparisonMismatches: [
            {
              rank: "diamond_plus",
              lane: "top",
              sectionKey: "matchups",
              sectionLabel: "матчапы",
              status: "same-date-mismatch",
              siteDataDate: "2026-04-05",
              sourceDataDate: "2026-04-05",
              siteVisibleCount: 29,
              siteTotalCount: 29,
              sourceVisibleCount: 29,
              sourceTotalCount: 29,
            },
          ],
        },
      ],
    },
  );

  assert.equal(report.status, "failed");
  assert.deepEqual(report.totals, {
    champions: 1,
    passed: 0,
    failed: 1,
    issues: 1,
    mismatches: 1,
    checkedCombos: 2,
  });
  assert.equal(report.failedChampions.length, 1);
  assert.deepEqual(report.failureSections, [
    { label: "матчапы", count: 1 },
    { label: "riftgg", count: 1 },
  ]);
});
