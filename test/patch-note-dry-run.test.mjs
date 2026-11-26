import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchDryRunReport } from "../lib/patchNoteDryRun.mjs";

test("dry-run report counts distinct entities and exposes unresolved non-system identities", () => {
  const report = buildPatchDryRunReport({
    patchVersion: "6.2k",
    locale: "en-us",
    sourceAction: "parse-archive",
    contentHash: "abc123",
    rows: [
      { entityKind: "champion", entitySlug: "swain", entityName: "Swain" },
      { entityKind: "champion", entitySlug: "swain", entityName: "Swain", sectionName: "Base stats" },
      { entityKind: "item", entitySlug: "nashors-tooth", entityName: "Nashor's Tooth" },
      { entityKind: "item", entityName: "Unknown item", sectionName: "Items" },
      { entityKind: "system", entityName: "Bug fixes", details: [] },
    ],
  });

  assert.deepEqual(report, {
    patchVersion: "6.2k",
    locale: "en-us",
    sourceAction: "parse-archive",
    contentHash: "abc123",
    rowCounts: { champion: 2, item: 2, system: 1 },
    entityCounts: { champion: 1, item: 2, system: 1 },
    unresolvedIdentities: [{ entityKind: "item", entityName: "Unknown item", sectionName: "Items" }],
    systemRowsWithoutSlug: ["Bug fixes"],
  });
});
