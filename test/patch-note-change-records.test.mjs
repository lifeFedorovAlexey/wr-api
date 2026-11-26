import assert from "node:assert/strict";
import test from "node:test";

import { buildPatchChangeRows, loadPatchChangeCatalog } from "../lib/patchNotesChangeRecords.mjs";
import * as dbSchema from "../db/schema.js";

const emptyCatalog = {
  champions: new Map(),
  items: new Map(),
  runes: new Map(),
  spells: new Map(),
  historicalRows: [],
};

function mockDb(rowsByTable) {
  return {
    select() {
      let table;
      const query = {
        from(value) {
          table = value;
          return this;
        },
        where() {
          return Promise.resolve(rowsByTable.get(table) || []);
        },
        then(resolve, reject) {
          return Promise.resolve(rowsByTable.get(table) || []).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function hubCatalogRow({ dataset, entityKind, entitySlug, name, patchVersion, sourceUpdatedAt, role, sourceKind = "hub-game", stateOverrides = {} }) {
  const sourceUrl = `https://hub-game.com/wildrift/en/${dataset}`;
  return {
    patchVersion,
    dataset,
    entityKind,
    entitySlug,
    state: {
      name,
      image: `https://hub-game.com/images/${entitySlug}.png`,
      ...(dataset === "summoner-spells" ? {
        snapshotScope: "current-baseline",
        historicalReconstruction: "not-performed",
      } : {}),
      source: { sourceUpdatedAt, snapshotScope: dataset === "summoner-spells" ? "current-baseline" : undefined },
      ...stateOverrides,
    },
    sourceKind,
    sourceUrl: `${sourceUrl}/${entitySlug}`,
    sourcePatchVersion: patchVersion,
    sourceUpdatedAt,
    verificationStatus: "verified",
    sourceEvidence: [{
      kind: sourceKind,
      role,
      url: sourceUrl,
      sourcePatchVersion: patchVersion,
      sourceUpdatedAt,
      ...(dataset === "summoner-spells" ? { snapshotScope: "current-baseline", historicalReconstruction: "not-performed" } : {}),
    }],
  };
}

test("loads latest Hub catalog aliases for items, runes, and spells without replacing guide identities", async () => {
  const latest = "2026-10-16";
  const older = "2026-09-01";
  const hubRows = [
    hubCatalogRow({ dataset: "items", entityKind: "item", entitySlug: "old-sword", name: "Old Catalog Sword", patchVersion: "7.2", sourceUpdatedAt: older, role: "item-catalog" }),
    hubCatalogRow({ dataset: "items", entityKind: "item", entitySlug: "new-sword", name: "Latest Catalog Sword", patchVersion: "7.3b", sourceUpdatedAt: latest, role: "item-catalog" }),
    hubCatalogRow({ dataset: "items", entityKind: "item", entitySlug: "hub-canonical-blade", name: "Canonical Blade", patchVersion: "7.3b", sourceUpdatedAt: latest, role: "item-catalog" }),
    hubCatalogRow({ dataset: "items", entityKind: "item", entitySlug: "removed-item", name: "Removed Item", patchVersion: "7.3b", sourceUpdatedAt: latest, role: "item-catalog", stateOverrides: { availability: "removed" } }),
    hubCatalogRow({ dataset: "runes", entityKind: "rune", entitySlug: "old-legend-tenacity", name: "Old Legend Tenacity", patchVersion: "7.2", sourceUpdatedAt: older, role: "rune-catalog" }),
    hubCatalogRow({ dataset: "runes", entityKind: "rune", entitySlug: "legend-tenacity", name: "Legend: Tenacity", patchVersion: "7.3b", sourceUpdatedAt: latest, role: "rune-catalog" }),
    hubCatalogRow({ dataset: "runes", entityKind: "rune", entitySlug: "historical-rune", name: "Reconstructed Historical Rune", patchVersion: "7.4", sourceUpdatedAt: "2026-10-17", role: "rune-catalog", stateOverrides: { snapshotScope: "historical", historicalReconstruction: "reconstructed" } }),
    hubCatalogRow({ dataset: "summoner-spells", entityKind: "spell", entitySlug: "old-flash", name: "Old Flash Alias", patchVersion: "7.2", sourceUpdatedAt: older, role: "summoner-spell-catalog", sourceKind: "hub-game-summoner-spells" }),
    hubCatalogRow({ dataset: "summoner-spells", entityKind: "spell", entitySlug: "flash", name: "Flash", patchVersion: "baseline-2026-10-16", sourceUpdatedAt: latest, role: "summoner-spell-catalog", sourceKind: "hub-game-summoner-spells" }),
  ];
  const guideRows = [
    { kind: "item", slug: "canonical-blade", name: "Canonical Blade", tooltipTitle: null, imageUrl: "https://guide.test/canonical.png", tooltipImageUrl: null },
  ];
  const historyRows = [
    { kind: "rune", slug: "old-legend-tenacity", name: "Legend: Tenacity", patchVersion: "4.3", changeType: "adjustment", imageUrl: null },
  ];
  const rowsByTable = new Map([
    [dbSchema.champions, []],
    [dbSchema.guideEntities, guideRows],
    [dbSchema.patchNoteChanges, historyRows],
    [dbSchema.patchDataSnapshots, hubRows],
  ]);

  const catalog = await loadPatchChangeCatalog(dbSchema, mockDb(rowsByTable));

  assert.equal(catalog.items.get("latest catalog sword")?.slug, "new-sword");
  assert.equal(catalog.items.has("old catalog sword"), false);
  assert.equal(catalog.items.get("canonical blade")?.slug, "canonical-blade");
  assert.equal(catalog.items.get("canonical blade")?.imageUrl, "https://guide.test/canonical.png");
  assert.equal(catalog.items.has("removed item"), false);
  assert.equal(catalog.runes.get("legend tenacity")?.slug, "legend-tenacity");
  assert.equal(catalog.runes.has("old legend tenacity"), false);
  assert.equal(catalog.runes.has("reconstructed historical rune"), false);
  assert.equal(catalog.spells.get("flash")?.slug, "flash");
  assert.equal(catalog.spells.has("old flash alias"), false);
});

test("maps the retired Umbral Glaive item name when parsing older official item notes", async () => {
  const rowsByTable = new Map([
    [dbSchema.champions, []],
    [dbSchema.guideEntities, []],
    [dbSchema.patchNoteChanges, []],
    [dbSchema.patchDataSnapshots, []],
  ]);
  const catalog = await loadPatchChangeCatalog(dbSchema, mockDb(rowsByTable));
  const [row] = buildPatchChangeRows([{
    entityKind: "item",
    entityName: "Umbral Glaive",
    details: [{ label: "Armor penetration", before: "10", after: "12", text: "Armor penetration: 10 → 12" }],
  }], catalog);

  assert.equal(row.entitySlug, "umbral-glaive");
  assert.equal(row.entityName, "Umbral Glaive");
  assert.equal(row.changeType, "buff");
});

test("resolves historical item names and typo variants to stable item identities", async () => {
  const guideRows = [
    { kind: "rune", slug: "ixtali-seedjar", name: "Ixtali Seedjar", tooltipTitle: null, imageUrl: null, tooltipImageUrl: null },
  ];
  const rowsByTable = new Map([
    [dbSchema.champions, []],
    [dbSchema.guideEntities, guideRows],
    [dbSchema.patchNoteChanges, []],
    [dbSchema.patchDataSnapshots, []],
  ]);
  const catalog = await loadPatchChangeCatalog(dbSchema, mockDb(rowsByTable));
  const aliases = [
    ["Ixtali Seedjar", "ixtali-seedjar"],
    ["Банка для семян", "ixtali-seedjar"],
    ["Navori Quickblade", "navori-quickblades"],
    ["Tailsman of Ascension", "talisman-of-ascension"],
    ["Mana Mune", "manamune"],
    ["AMARANTH TWINGUARD", "amaranths-twinguard"],
    ["Hextech GLP- 800", "hextech-glp-800"],
    ["Хекстековая НЛП 800", "hextech-glp-800"],
  ];

  for (const [entityName, expectedSlug] of aliases) {
    const [row] = buildPatchChangeRows([{
      entityKind: "item",
      entityName,
      details: [{ label: "Price", before: "1000", after: "900", text: "Price: 1000 → 900" }],
    }], catalog);
    assert.equal(row.entitySlug, expectedSlug, entityName);
  }
  assert.equal(catalog.runes.get("ixtali seedjar")?.slug, "ixtali-seedjar");
  assert.equal(catalog.runes.get("банка для семян")?.slug, "ixtali-seedjar");
});

test("maps the 1.1 Russian Teleport Enchant by identity instead of a shared Stasis price signature", async () => {
  const details = (before, after) => [{
    before,
    after,
    text: `Cost: ${before} → ${after}`,
  }];
  const englishChanges = [
    {
      entityKind: "item",
      entityName: "TELEPORT ENCHANT",
      details: details("1000g", "800g"),
    },
    {
      entityKind: "item",
      entitySlug: "stasis-enchant",
      entityName: "Stasis Enchant",
      imageUrl: "https://example.test/stasis.png",
      details: details("1000g", "800g"),
    },
  ];
  const rowsByTable = new Map([
    [dbSchema.champions, []],
    [dbSchema.guideEntities, []],
    [dbSchema.patchNoteChanges, []],
    [dbSchema.patchDataSnapshots, []],
  ]);
  const catalog = await loadPatchChangeCatalog(dbSchema, mockDb(rowsByTable));

  const [row] = buildPatchChangeRows([{
    entityKind: "item",
    entityName: "Зачарование телепорта",
    details: details("1000 золота", "800 золота."),
  }], catalog, englishChanges, "1.1");

  assert.equal(row.entitySlug, "teleport-enchant");
  assert.notEqual(row.entitySlug, "stasis-enchant");
  assert.equal(row.imageUrl, null);
});

test("maps localized and source-spelling aliases for historical items and runes", async () => {
  const rowsByTable = new Map([
    [dbSchema.champions, []],
    [dbSchema.guideEntities, []],
    [dbSchema.patchNoteChanges, []],
    [dbSchema.patchDataSnapshots, []],
  ]);
  const catalog = await loadPatchChangeCatalog(dbSchema, mockDb(rowsByTable));
  const normalizeAlias = (value) => String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [alias, slug] of [
    ["harrowing crescent", "harrowing-crescent"],
    ["страховинский крюк", "harrowing-crescent"],
    ["boots of furor", "boots-of-furor"],
    ["ботинки ярости", "boots-of-furor"],
    ["redeeming enchant", "redeeming-enchant"],
    ["зачарование искупления", "redeeming-enchant"],
    ["spectral sickle", "spectral-sickle"],
    ["призрачный серп", "spectral-sickle"],
    ["repulsor enchant", "repulsor-enchant"],
    ["репульсор", "repulsor-enchant"],
    ["HEXTECH PROTOBELT ENCHANTMENT", "protobelt-enchant"],
    ["TELEPORT ENCHANT", "teleport-enchant"],
    ["Зачарование телепорта", "teleport-enchant"],
    ["Зачарование стазиса", "stasis-enchant"],
    ["NINJA TABI", "ninja-tabi"],
    ["Таби ниндзя", "ninja-tabi"],
    ["GARGOYLE ENCHANT", "stoneplate-enchant"],
    ["Athene's Unholy Grail", "athenes-unholy-grail"],
    ["Нечестивый грааль Афина", "athenes-unholy-grail"],
    ["Spirit Visage", "spirit-visage"],
    ["Облачение духов", "spirit-visage"],
    ["Терновый жилет", "bramble-vest"],
    ["Призвание палача", "executioners-calling"],
    ["Боевой молот Колфилда", "caulfields-warhammer"],
    ["Теневая глефа", "umbral-glaive"],
    ["Сияние", "sheen"],
    ["Воспламеняющий камень", "kindlegem"],
    ["Ледяная пелена", "glacial-shroud"],
    ["Crystalline Reflector", "crystalline-reflector"],
    ["Кристаллический отражатель", "crystalline-reflector"],
    ["Solari Chargeblade", "solari-chargeblade"],
    ["Заряженный клинок Солари", "solari-chargeblade"],
    ["Frozen Mallet", "frozen-mallet"],
    ["Замерзший молот", "frozen-mallet"],
    ["Guardian's Vow", "knights-vow"],
    ["Сфера забвения", "oblivion-orb"],
  ]) {
    assert.equal(catalog.items.get(normalizeAlias(alias))?.slug, slug, `item alias ${alias}`);
  }

  for (const [alias, slug] of [
    ["first strike", "first-strike"],
    ["первый удар", "first-strike"],
    ["legend tenacity", "legend-tenacity"],
    ["стойкость", "legend-tenacity"],
    ["mark of the weak", "mark-of-the-weak"],
    ["признак слабости", "mark-of-the-weak"],
    ["hextech flastraption", "hextech-flashtraption"],
    ["хекстековый скачок", "hextech-flashtraption"],
    ["kraken slayer", "kraken-slayer"],
    ["убийца кракенов", "kraken-slayer"],
    ["Hunter: Genius", "hunter-genius"],
    ["Охотник: гений", "hunter-genius"],
  ]) {
    assert.equal(catalog.runes.get(normalizeAlias(alias))?.slug, slug, `rune alias ${alias}`);
  }
  assert.equal(catalog.items.has(normalizeAlias("Убийца кракенов")), false,
    "the historical Kraken Slayer rune must not be registered as an item alias");
  assert.equal(catalog.runes.has(normalizeAlias("Guardian's Vow")), false,
    "the 1.1 English item name must not resolve to the Guardian rune");
});

test("does not fall back to a historical rune name when the latest Hub catalog mapping is ambiguous", async () => {
  const currentRows = [
    hubCatalogRow({ dataset: "runes", entityKind: "rune", entitySlug: "rune-alpha", name: "Conflicted Rune", patchVersion: "7.3b", sourceUpdatedAt: "2026-10-16", role: "rune-catalog" }),
    hubCatalogRow({ dataset: "runes", entityKind: "rune", entitySlug: "rune-beta", name: "Conflicted Rune", patchVersion: "7.3b", sourceUpdatedAt: "2026-10-16", role: "rune-catalog" }),
  ];
  const guideRows = [{ kind: "rune", slug: "old-rune", name: "Old Rune Name", tooltipTitle: null, imageUrl: null, tooltipImageUrl: null }];
  const historyRows = [{ kind: "rune", slug: "old-rune", name: "Conflicted Rune", patchVersion: "4.3", changeType: "adjustment", imageUrl: null }];
  const rowsByTable = new Map([
    [dbSchema.champions, []],
    [dbSchema.guideEntities, guideRows],
    [dbSchema.patchNoteChanges, historyRows],
    [dbSchema.patchDataSnapshots, currentRows],
  ]);

  const catalog = await loadPatchChangeCatalog(dbSchema, mockDb(rowsByTable));

  assert.equal(catalog.runes.has("conflicted rune"), false);
});

test("rejects mixed Hub source metadata in the latest baseline instead of choosing a source by row order", async () => {
  const currentRows = [
    hubCatalogRow({ dataset: "runes", entityKind: "rune", entitySlug: "rune-alpha", name: "Rune Alpha", patchVersion: "7.3b", sourceUpdatedAt: "2026-10-16", role: "rune-catalog" }),
    {
      ...hubCatalogRow({ dataset: "runes", entityKind: "rune", entitySlug: "rune-beta", name: "Rune Beta", patchVersion: "7.3b", sourceUpdatedAt: "2026-10-16", role: "rune-catalog" }),
      sourceEvidence: [{ kind: "hub-game", role: "rune-catalog", url: "https://other.example/runes", sourcePatchVersion: "7.3b", sourceUpdatedAt: "2026-10-16" }],
    },
  ];
  const rowsByTable = new Map([
    [dbSchema.champions, []],
    [dbSchema.guideEntities, []],
    [dbSchema.patchNoteChanges, []],
    [dbSchema.patchDataSnapshots, currentRows],
  ]);

  await assert.rejects(
    loadPatchChangeCatalog(dbSchema, mockDb(rowsByTable)),
    /Conflicting Hub catalog source metadata in latest runes baseline/,
  );
});

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

test("keeps opposing rank directions as adjustments without cancelling them", () => {
  const [row] = buildPatchChangeRows([{
    entityKind: "champion",
    entitySlug: "ranked-champion",
    entityName: "Ranked Champion",
    changeName: "Ability",
    details: [{ label: "Damage", before: "20/30/40/50", after: "10/25/40/55", text: "Damage: 20/30/40/50 → 10/25/40/55" }],
  }], emptyCatalog);

  assert.equal(row.changeType, "adjustment");
});

test("preserves an explicit source changeType when canonicalizing source rows", () => {
  const [row] = buildPatchChangeRows([{
    entityKind: "rune",
    entitySlug: "cheap-shot",
    entityName: "Cheap Shot",
    changeType: "nerf",
    details: [{ label: "Cooldown", before: "7s", after: "5s", text: "Cooldown: 7s → 5s" }],
  }], emptyCatalog);

  assert.equal(row.changeType, "nerf");
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
