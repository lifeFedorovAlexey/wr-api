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

test("treats collapsed per-level ranges and unequal value vectors as adjustments", () => {
  const cases = [
    {
      entitySlug: "tryndamere",
      entityName: "Tryndamere",
      details: [
        {
          label: "Critical Strike Chance per Fury",
          before: "0.3%-0.5% (based on level)",
          after: "0.5%",
          text: "Critical Strike Chance per Fury: 0.3%-0.5% (based on level) → 0.5%",
        },
        {
          label: "Damage",
          before: "80/120/160/200 + 100% Bonus Attack Damage + 80% Ability Power",
          after: "80/130/180/230 + 110% Bonus Attack Damage + 80% Ability Power",
          text: "Damage: 80/120/160/200 + 100% Bonus Attack Damage + 80% Ability Power → 80/130/180/230 + 110% Bonus Attack Damage + 80% Ability Power",
        },
      ],
    },
    {
      entitySlug: "vector-champion",
      entityName: "Vector Champion",
      details: [{ label: "Damage by rank", before: "100/120/140", after: "110/110", text: "Damage by rank: 100/120/140 → 110/110" }],
    },
  ];

  for (const change of cases) {
    const [row] = buildPatchChangeRows([{
      entityKind: "champion",
      changeName: "Ability",
      ...change,
    }], emptyCatalog);
    assert.equal(row.changeType, "adjustment", change.entityName);
  }
});

test("classifies aligned vectors by their shared direction, ignoring unchanged ranks", () => {
  const [row] = buildPatchChangeRows([{
    entityKind: "champion",
    entitySlug: "aligned-champion",
    entityName: "Aligned Champion",
    changeName: "Ability",
    details: [{ label: "Damage", before: "80/120/160/200", after: "80/130/180/230", text: "Damage: 80/120/160/200 → 80/130/180/230" }],
  }], emptyCatalog);

  assert.equal(row.changeType, "buff");
});

test("opposing rank changes remain adjustments regardless of their aggregate direction", () => {
  for (const [before, after] of [["10/20", "20/15"], ["20/30/40/50", "10/25/40/55"], ["10/20", "20/10"]]) {
    const [row] = buildPatchChangeRows([{
      entityKind: "champion",
      entitySlug: "ranked-champion",
      entityName: "Ranked Champion",
      changeName: "Ability",
      details: [{ label: "Damage", before, after, text: `Damage: ${before} → ${after}` }],
    }], emptyCatalog);

    assert.equal(row.changeType, "adjustment", `${before} → ${after}`);
  }
});

test("threshold utility follows explicit conditions and leaves bare thresholds unresolved", () => {
  for (const [label, expected] of [
    ["Execute health threshold", "buff"], ["Порог здоровья для казни", "buff"],
    ["Minimum bonus health threshold", "nerf"], ["Минимальный порог дополнительного здоровья", "nerf"],
    ["Trigger threshold", "adjustment"], ["Порог срабатывания", "adjustment"],
  ]) {
    for (const entityKind of ["champion", "item", "rune"]) {
      const [row] = buildPatchChangeRows([{
        entityKind, entitySlug: "threshold-entity", entityName: "Threshold Entity",
        details: [{ label, before: "5%", after: "10%", text: `${label}: 5% → 10%` }],
      }], emptyCatalog);
      assert.equal(row.changeType, expected, `${entityKind}: ${label}`);
    }
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
