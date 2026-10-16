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

test("classifies increased champion drawbacks as nerfs from stat labels in both locales", () => {
  const inputs = [
    ["K'Sante", "All Out", [
      ["Max Health lost", "25%", "30%"],
      ["Bonus Armor lost", "70%", "80%"],
      ["Bonus Magic Resist lost", "70%", "80%"],
    ]],
    ["К'Санте", "Высвобождение", [
      ["Потеря максимального здоровья", "25%", "30%"],
      ["Потеря дополнительной брони", "70%", "80%"],
      ["Потеря дополнительного сопротивления магии", "70%", "80%"],
    ]],
  ];

  for (const [entityName, changeName, details] of inputs) {
    const [row] = buildPatchChangeRows([{
      entityKind: "champion",
      entitySlug: "ksante",
      entityName,
      changeName,
      details: details.map(([label, before, after]) => ({
        label,
        before,
        after,
        text: `${label}: ${before} → ${after}`,
        component: changeName,
      })),
    }], emptyCatalog);

    assert.equal(row.changeType, "nerf");
    assert.equal(row.changeName, changeName);
    assert.ok(row.details.every((detail) => detail.component === changeName));
  }
});

test("reclassifies a new marker only when the entity appears in an earlier patch", () => {
  const change = {
    entityKind: "item",
    entitySlug: "noonquiver",
    entityName: "Noonquiver",
    changeName: "new",
    details: [],
  };
  const catalog = {
    ...emptyCatalog,
    historicalRows: [{ kind: "item", slug: "noonquiver", name: "Noonquiver", patchVersion: "7.2" }],
  };

  const [previouslyReleased] = buildPatchChangeRows([change], catalog, [], "7.3");
  const [debut] = buildPatchChangeRows([change], emptyCatalog, [], "7.3");

  assert.equal(previouslyReleased.changeType, "adjustment");
  assert.equal(previouslyReleased.changeName, null);
  assert.equal(debut.changeType, "new");
  assert.equal(debut.changeName, "new");
});
