import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchChangeRows } from "../lib/patchNotesChangeRecords.mjs";

const emptyCatalog = {
  champions: new Map(),
  items: new Map(),
  runes: new Map(),
  spells: new Map(),
  historicalRows: [],
};

test("keeps the same item narrative when it belongs to different components", () => {
  const rows = buildPatchChangeRows([
    {
      entityKind: "item",
      entitySlug: "test-item",
      entityName: "Test Item",
      details: [{ text: "Removed", component: "Active" }],
    },
    {
      entityKind: "item",
      entitySlug: "test-item",
      entityName: "Test Item",
      details: [{ text: "Removed", component: "Passive" }],
    },
  ], emptyCatalog);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].details.map((detail) => detail.component), ["Active", "Passive"]);
});

test("uses the fallback icon when a catalog rune has no image URL", () => {
  const catalog = {
    ...emptyCatalog,
    runes: new Map([["legend tenacity", { slug: "legend-tenacity", name: "Legend Tenacity" }]]),
  };
  const [row] = buildPatchChangeRows([{
    entityKind: "rune",
    entitySlug: "legend-tenacity",
    entityName: "Legend Tenacity",
    details: [],
  }], catalog);

  assert.match(row.imageUrl, /\/wr-api\/api\/assets\/guide-rune-legend-tenacity-image\?src=/);
});
