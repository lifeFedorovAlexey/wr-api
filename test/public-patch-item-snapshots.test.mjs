import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameItemDetail } from "../lib/hubGameItemDetail.mjs";
import { buildHubGameItemSnapshotRows, parseHubGameItemCatalogIndex } from "../lib/hubGameItemSnapshots.mjs";
import { buildPublicPatchItemData } from "../lib/publicPatchItemSnapshots.mjs";
import { buildPublicPatchItemDataForDetail } from "../lib/publicPatchItemDataForDetail.mjs";

const itemCatalogUrl = "https://hub-game.com/wildrift/en/items";
const itemCatalogFixture = await readFile(new URL("./fixtures/hub-game-item-baseline-index.html", import.meta.url), "utf8");
const warmogDetailFixture = await readFile(new URL("./fixtures/hub-game-warmogs-detail.html", import.meta.url), "utf8");

function snapshot(overrides = {}) {
  return {
    patchVersion: "7.3b",
    dataset: "items",
    entitySlug: "infinity-edge",
    state: {
      name: "Infinity Edge",
      image: "https://hub-game.com/wildrift/images/items/infinity-edge.webp",
      cost: 3400,
      stats: ["+75 Attack Damage"],
      passives: [{ name: "Infinity", description: "Critical Strikes deal 230% damage instead of 200%.", type: "passive" }],
      actives: [],
      effects: [{ name: "Infinity", description: "Critical Strikes deal 230% damage instead of 200%.", type: "passive" }],
      dataCoverage: "detail-page",
      sourceHistory: {
        coverage: "partial-or-absent",
        entries: [{
          patch: "7.2",
          patchLink: { url: "https://hub-game.com/wildrift/en/patches/7-2", label: "Patch 7.2" },
          category: "Nerf",
          changes: [{ group: null, label: "Cost", before: "3200", after: "3400" }],
        }],
      },
    },
    verificationStatus: "verified",
    sourceKind: "hub-game",
    sourceUrl: "https://hub-game.com/wildrift/en/items/infinity-edge",
    sourcePatchVersion: "7.3b",
    sourceUpdatedAt: "2026-10-16",
    sourceEvidence: [{
      kind: "hub-game",
      role: "item-catalog",
      url: "https://hub-game.com/wildrift/en/items",
      sourcePatchVersion: "7.3b",
      sourceUpdatedAt: "2026-10-16",
    }],
    ...overrides,
  };
}

function currentCatalogSnapshot(version, updatedAt, slug, name, listedItemCount, overrides = {}) {
  const catalogEvidence = {
    kind: "hub-game",
    role: "item-catalog",
    snapshotScope: "current-baseline",
    historicalReconstruction: "not-performed",
    url: itemCatalogUrl,
    sourcePatchVersion: version,
    sourceUpdatedAt: updatedAt,
    sourceBasis: `hub-catalog-${version}`,
    listedItemCount,
    linkedDetailPageCount: listedItemCount,
  };
  return {
    patchVersion: version,
    dataset: "items",
    entityKind: "item",
    entitySlug: slug,
    state: {
      name,
      availability: "available",
      image: `https://hub-game.com/wildrift/images/items/${slug}.webp`,
      cost: 1000,
      stats: [],
      effects: [],
      dataCoverage: "catalog-card-only",
      snapshotScope: "current-baseline",
      historicalReconstruction: "not-performed",
    },
    verificationStatus: "partial",
    sourceKind: "hub-game",
    sourceUrl: `${itemCatalogUrl}/${slug}`,
    sourcePatchVersion: version,
    sourceUpdatedAt: updatedAt,
    sourceEvidence: [catalogEvidence],
    ...overrides,
  };
}

test("projects current item values with exact patch provenance", () => {
  const result = buildPublicPatchItemData([snapshot()], "7.3b");
  assert.equal(result.patchVersion, "7.3b");
  assert.equal(result.snapshotScope, "current-baseline");
  assert.equal(result.historicalReconstruction, "not-performed");
  assert.equal(result.source.effectivePatchVersion, "7.3b");
  assert.deepEqual(result.items[0], {
    slug: "infinity-edge",
    name: "Infinity Edge",
    image: "https://hub-game.com/wildrift/images/items/infinity-edge.webp",
    currentCost: 3400,
    stats: ["+75 Attack Damage"],
    passives: [{ name: "Infinity", description: "Critical Strikes deal 230% damage instead of 200%.", type: "passive", classification: "source-label" }],
    actives: [],
    effects: [{ name: "Infinity", description: "Critical Strikes deal 230% damage instead of 200%.", type: "passive", classification: "source-label" }],
    dataCoverage: "detail-page",
    sourceHistory: {
      coverage: "partial-or-absent",
      entries: [{
        patch: "7.2",
        patchLink: { url: "https://hub-game.com/wildrift/en/patches/7-2", label: "Patch 7.2" },
        category: "Nerf",
        changes: [{ group: null, label: "Cost", before: "3200", after: "3400" }],
      }],
    },
    verificationStatus: "verified",
    provenance: {
      kind: "hub-game",
      url: "https://hub-game.com/wildrift/en/items/infinity-edge",
      sourcePatchVersion: "7.3b",
      sourceUpdatedAt: "2026-10-16",
      scope: "current-baseline",
      sourceEvidence: [snapshot().sourceEvidence[0]],
    },
  });
});

test("does not project the 7.3b item baseline into older or newer patch details", () => {
  assert.equal(buildPublicPatchItemData([snapshot()], "7.2"), null);
  assert.equal(buildPublicPatchItemData([snapshot()], "7.4"), null);
});

test("rejects snapshots with mismatched effective version, source, or scope", () => {
  assert.equal(buildPublicPatchItemData([snapshot({ sourcePatchVersion: "7.2" })], "7.3b"), null);
  assert.equal(buildPublicPatchItemData([snapshot({ sourceKind: "riot-patch-notes" })], "7.3b"), null);
  assert.equal(buildPublicPatchItemData([snapshot({
    state: { ...snapshot().state, snapshotScope: "historical-transition" },
  })], "7.3b"), null);
  assert.equal(buildPublicPatchItemData([snapshot({
    sourceEvidence: [{ role: "item-detail", sourcePatchVersion: "7.3b", sourceUpdatedAt: "2026-10-16" }],
  })], "7.3b"), null);
});

test("does not project old removal rows or fabricate an empty result", () => {
  const removed = snapshot({
    sourcePatchVersion: "7.1",
    state: { name: "Removed Item", availability: "removed", cost: null },
  });
  assert.equal(buildPublicPatchItemData([removed], "7.3b"), null);
  assert.equal(buildPublicPatchItemData([], "7.3b"), null);
});

test("projects the real Hub item parser snapshot only at the source's explicit patch", () => {
  const catalog = parseHubGameItemCatalogIndex(itemCatalogFixture, itemCatalogUrl);
  const detail = parseHubGameItemDetail(warmogDetailFixture, "https://hub-game.com/wildrift/en/items/warmogs-armor");
  const { rows } = buildHubGameItemSnapshotRows(catalog, [detail]);
  const projected = buildPublicPatchItemData(rows, "7.3b");

  assert.equal(projected.items.length, 2);
  assert.equal(projected.items.find((item) => item.slug === "warmogs-armor").currentCost, 2850);
  assert.equal(projected.items.find((item) => item.slug === "warmogs-armor").passives.length, 2);
  assert.equal(projected.items.find((item) => item.slug === "warmogs-armor").passives[0].classification, "item-effects-section-default");
  assert.deepEqual(
    projected.items.find((item) => item.slug === "warmogs-armor").sourceHistory,
    rows.find((row) => row.entitySlug === "warmogs-armor").state.sourceHistory,
    "parsed Hub history should reach the public exact-snapshot item projection",
  );
  assert.equal(projected.items.find((item) => item.slug === "infinity-orb").verificationStatus, "partial");
  assert.equal(buildPublicPatchItemData(rows, "7.2"), null);
});

test("preserves a truthful empty history marker when the Hub source has no item history", () => {
  const result = buildPublicPatchItemData([snapshot({
    state: { ...snapshot().state, sourceHistory: null },
  })], "7.3b");

  assert.deepEqual(result.items[0].sourceHistory, { coverage: "not-provided", entries: [] });
});

test("normalizes Hub active labels and inferred passive effects for API consumers", () => {
  const result = buildPublicPatchItemData([snapshot({
    state: {
      ...snapshot().state,
      effects: [
        { name: "Stasis (Active)Active", description: "Become untargetable.", type: null },
        { name: "Galeforce (Active)", description: "Dash and deal damage.", type: "passive" },
        { name: "Warmog's Heart", description: "Restore health outside combat.", type: null },
      ],
      passives: [],
      actives: [],
    },
  })], "7.3b");
  assert.deepEqual(result.items[0].passives.map((effect) => effect.name), ["Warmog's Heart"]);
  assert.deepEqual(result.items[0].actives.map((effect) => effect.name), ["Stasis", "Galeforce"]);
  assert.deepEqual(result.items[0].effects, [
    { name: "Stasis", description: "Become untargetable.", type: "active", classification: "source-label" },
    { name: "Galeforce", description: "Dash and deal damage.", type: "active", classification: "source-label" },
    { name: "Warmog's Heart", description: "Restore health outside combat.", type: "passive", classification: "item-effects-section-default" },
  ]);
});

test("keeps 7.3b exact itemData separate from the freshest complete current baseline", () => {
  const completeCurrentRows = [
    currentCatalogSnapshot("7.3b", "2026-10-16", "infinity-edge", "Infinity Edge", 2),
    currentCatalogSnapshot("7.3b", "2026-10-16", "warmogs-armor", "Warmog's Armor", 2),
  ];
  const incompleteNewerRow = currentCatalogSnapshot("7.4", "2026-10-17", "new-item", "New Item", 2);
  const changes = [{ entityKind: "item", entitySlug: "riot-item-legacy", entityName: "Старый предмет" }];
  const englishChanges = [{ entityKind: "item", entitySlug: "riot-item-legacy", entityName: "Infinity Edge" }];

  const result = buildPublicPatchItemDataForDetail({
    patchVersion: "7.3b",
    snapshots: [...completeCurrentRows, incompleteNewerRow],
    changes,
    englishChanges,
  });

  assert.equal(result.itemData.patchVersion, "7.3b");
  assert.deepEqual(result.itemData.items.map((item) => item.slug), ["infinity-edge", "warmogs-armor"]);
  assert.equal(result.currentItemBaseline.patchVersion, "7.3b");
  assert.equal(result.currentItemBaseline.requestedPatchVersion, "7.3b");
  assert.equal(result.currentItemBaseline.catalogCoverage.complete, true);
  assert.equal(result.currentItemBaseline.catalogCoverage.listedItemCount, 2);
  assert.equal(result.currentItemBaseline.catalogCoverage.completeForListedCatalog, true);
  assert.equal(result.currentItemBaseline.catalogCoverage.completeItemDetails, false);
  assert.equal(result.currentItemBaseline.catalogCoverage.catalogOnlyItemCount, 2);
  assert.equal(result.currentItemBaseline.catalogCoverage.verificationStatus, "partial");
  assert.equal(result.currentItemBaseline.verificationStatus, "partial");
  assert.equal(result.changes[0].baselineItemSlug, "infinity-edge");
  assert.equal(result.changes[0].entityName, "Старый предмет", "linking must preserve the Russian patch-note display name");
  assert.equal(result.changes[0].entitySlug, "riot-item-legacy", "linking must preserve the Riot patch-note identity");
});

test("serves the current Hub baseline beside 7.2 without implying 7.2 history", () => {
  const snapshots = [
    currentCatalogSnapshot("7.3b", "2026-10-16", "infinity-edge", "Infinity Edge", 2),
    currentCatalogSnapshot("7.3b", "2026-10-16", "warmogs-armor", "Warmog's Armor", 2),
    currentCatalogSnapshot("7.4", "2026-10-17", "new-item", "New Item", 2),
  ];
  const result = buildPublicPatchItemDataForDetail({
    patchVersion: "7.2",
    snapshots,
  });

  assert.equal(result.itemData, null, "itemData stays exact to 7.2 and no 7.2 catalog snapshot is available");
  assert.equal(result.currentItemBaseline.patchVersion, "7.3b");
  assert.equal(result.currentItemBaseline.requestedPatchVersion, "7.2");
  assert.equal(result.currentItemBaseline.snapshotScope, "current-baseline");
  assert.equal(result.currentItemBaseline.historicalReconstruction, "not-performed");
  assert.deepEqual(result.currentItemBaseline.items.map((item) => item.slug), ["infinity-edge", "warmogs-armor"]);
});

test("accepts older persisted catalog evidence when the explicit catalog count proves the full baseline", () => {
  const snapshots = [
    currentCatalogSnapshot("7.3b", "2026-10-16", "infinity-edge", "Infinity Edge", 2),
    currentCatalogSnapshot("7.3b", "2026-10-16", "warmogs-armor", "Warmog's Armor", 2),
  ].map((row) => {
    const persisted = structuredClone(row);
    delete persisted.state.snapshotScope;
    delete persisted.state.historicalReconstruction;
    delete persisted.sourceEvidence[0].snapshotScope;
    delete persisted.sourceEvidence[0].historicalReconstruction;
    delete persisted.sourceEvidence[0].sourceBasis;
    delete persisted.sourceEvidence[0].linkedDetailPageCount;
    return persisted;
  });

  const result = buildPublicPatchItemDataForDetail({ patchVersion: "7.2", snapshots });
  assert.equal(result.itemData, null);
  assert.equal(result.currentItemBaseline.patchVersion, "7.3b");
  assert.equal(result.currentItemBaseline.catalogCoverage.snapshotRowCount, 2);
  assert.equal(result.currentItemBaseline.historicalReconstruction, "not-performed");
});

test("accepts the complete 179-item catalog when optional source basis is missing on some rows", () => {
  const snapshots = Array.from({ length: 179 }, (_, index) => {
    const row = currentCatalogSnapshot(
      "7.3b",
      "2026-10-16",
      `item-${String(index + 1).padStart(3, "0")}`,
      `Item ${index + 1}`,
      179,
    );
    if (index >= 92) delete row.sourceEvidence[0].sourceBasis;
    return row;
  });

  const result = buildPublicPatchItemDataForDetail({ patchVersion: "7.3b", snapshots });

  assert.equal(result.currentItemBaseline.patchVersion, "7.3b");
  assert.equal(result.currentItemBaseline.catalogCoverage.listedItemCount, 179);
  assert.equal(result.currentItemBaseline.catalogCoverage.snapshotRowCount, 179);
  assert.equal(result.currentItemBaseline.catalogCoverage.includedItemCount, 179);
  assert.equal(result.currentItemBaseline.catalogCoverage.complete, true);
  assert.equal(result.currentItemBaseline.catalogCoverage.completeForListedCatalog, true);
  assert.equal(result.currentItemBaseline.catalogCoverage.completeItemDetails, false);
  assert.equal(result.currentItemBaseline.catalogCoverage.catalogOnlyItemCount, 179);
  assert.equal(result.currentItemBaseline.catalogCoverage.verificationStatus, "partial");
  assert.equal(result.currentItemBaseline.verificationStatus, "partial");
});

test("distinguishes a complete item roster from incomplete detail coverage", () => {
  const detailed = currentCatalogSnapshot("7.3b", "2026-10-16", "infinity-edge", "Infinity Edge", 2);
  const catalogOnly = currentCatalogSnapshot("7.3b", "2026-10-16", "warmogs-armor", "Warmog's Armor", 2);
  for (const row of [detailed, catalogOnly]) row.sourceEvidence[0].linkedDetailPageCount = 1;
  detailed.state.dataCoverage = "detail-page";
  detailed.verificationStatus = "verified";

  const result = buildPublicPatchItemDataForDetail({ patchVersion: "7.2", snapshots: [detailed, catalogOnly] });

  assert.equal(result.currentItemBaseline.catalogCoverage.completeForListedCatalog, true);
  assert.equal(result.currentItemBaseline.catalogCoverage.detailPageItemCount, 1);
  assert.equal(result.currentItemBaseline.catalogCoverage.catalogOnlyItemCount, 1);
  assert.equal(result.currentItemBaseline.catalogCoverage.incompleteDataItemCount, 1);
  assert.equal(result.currentItemBaseline.catalogCoverage.completeItemDetails, false);
  assert.equal(result.currentItemBaseline.catalogCoverage.verificationStatus, "partial");
});

test("rejects a complete catalog when non-empty source bases conflict", () => {
  const snapshots = Array.from({ length: 179 }, (_, index) => {
    const row = currentCatalogSnapshot(
      "7.3b",
      "2026-10-16",
      `item-${String(index + 1).padStart(3, "0")}`,
      `Item ${index + 1}`,
      179,
    );
    row.sourceEvidence[0].sourceBasis = index < 92 ? "hub-catalog-7.3b" : "other-catalog-basis";
    return row;
  });

  const result = buildPublicPatchItemDataForDetail({ patchVersion: "7.3b", snapshots });

  assert.equal(result.currentItemBaseline, null);
});
