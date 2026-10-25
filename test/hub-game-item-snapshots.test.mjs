import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameItemDetail } from "../lib/hubGameItemDetail.mjs";
import { assertImmutablePatchSnapshot } from "../lib/patchChampionStatSnapshots.mjs";
import {
  buildHubGameItemSnapshotRows,
  parseHubGameItemCatalogIndex,
} from "../lib/hubGameItemSnapshots.mjs";

const catalogUrl = "https://hub-game.com/wildrift/en/items";
const detailUrl = "https://hub-game.com/wildrift/en/items/warmogs-armor";
const indexFixture = await readFile(new URL("./fixtures/hub-game-item-baseline-index.html", import.meta.url), "utf8");
const detailFixture = await readFile(new URL("./fixtures/hub-game-warmogs-detail.html", import.meta.url), "utf8");

test("builds one current snapshot per catalog item and marks catalog-only coverage partial", () => {
  const catalog = parseHubGameItemCatalogIndex(indexFixture, catalogUrl);
  const detail = parseHubGameItemDetail(detailFixture, detailUrl);
  const result = buildHubGameItemSnapshotRows(catalog, [detail]);

  assert.deepEqual(catalog.detailLinks, [{ url: detailUrl, name: "Warmog's Armor" }]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.coverage, {
    patchVersion: "7.3b",
    sourceUpdatedAt: "2026-10-16",
    catalogItemCount: 2,
    linkedDetailPageCount: 1,
    parsedDetailPageCount: 1,
    currentDetailPageSnapshotCount: 1,
    catalogOnlySnapshotCount: 1,
    explicitlyRemovedDetailPageCount: 0,
    snapshotRowCount: 2,
    verifiedSnapshotRowCount: 1,
    partialSnapshotRowCount: 1,
    currentDetailPageCoveragePercent: 50,
    parsedDetailPageCoveragePercent: 100,
    catalogIdentityRowCoveragePercent: 100,
    historicalVersionsCreated: 0,
  });

  const warmog = result.rows.find((row) => row.entitySlug === "warmogs-armor");
  assert.equal(warmog.patchVersion, "7.3b");
  assert.equal(warmog.dataset, "items");
  assert.equal(warmog.verificationStatus, "verified");
  assert.equal(warmog.state.dataCoverage, "detail-page");
  assert.equal(warmog.state.sourceHistory.entries.length, 1);
  assert.equal(warmog.contentHash.length, 64);

  const orb = result.rows.find((row) => row.state.name === "Infinity Orb");
  assert.equal(orb.verificationStatus, "partial");
  assert.equal(orb.state.dataCoverage, "catalog-card-only");
  assert.deepEqual(orb.state.sourceHistory, { coverage: "not-provided-on-catalog-card", entries: [] });
  assert.equal(orb.state.stats.length, 2);
});

test("stores explicit removals as partial removal states instead of current stats", () => {
  const removedIndex = indexFixture
    .replaceAll("Warmog's Armor", "Magnetic Blaster")
    .replaceAll("warmogs-armor", "magnetic-blaster");
  const removedPage = detailFixture
    .replaceAll("Warmog's Armor", "Magnetic Blaster")
    .replaceAll("warmogs-armor", "magnetic-blaster")
    .replace("Effects and values: transcribed from the game, with official patch note changes applied through patch 7.3b (updated 2026-10-16)", "This item was removed from the game in patch 7.3. The effects and build data below are from before its removal.");
  const catalog = parseHubGameItemCatalogIndex(removedIndex, catalogUrl);
  const detail = parseHubGameItemDetail(removedPage, "https://hub-game.com/wildrift/en/items/magnetic-blaster");
  const result = buildHubGameItemSnapshotRows(catalog, [detail]);
  const item = result.rows.find((row) => row.entitySlug === "magnetic-blaster");

  assert.equal(item.patchVersion, "7.3b");
  assert.equal(item.verificationStatus, "partial");
  assert.equal(item.sourcePatchVersion, "7.3");
  assert.equal(item.state.availability, "removed");
  assert.equal(item.state.removedInPatch, "7.3");
  assert.equal(item.state.dataCoverage, "explicit-removal-with-last-known-values");
  assert.equal("cost" in item.state, false);
  assert.equal(result.coverage.explicitlyRemovedDetailPageCount, 1);
});

test("refuses incomplete detail fetches and source versions that disagree", () => {
  const catalog = parseHubGameItemCatalogIndex(indexFixture, catalogUrl);
  const detail = parseHubGameItemDetail(detailFixture, detailUrl);

  assert.throws(() => buildHubGameItemSnapshotRows(catalog, []), /coverage mismatch/);
  assert.throws(() => buildHubGameItemSnapshotRows(catalog, [{
    ...detail,
    source: { ...detail.source, snapshot: { ...detail.source.snapshot, version: "7.2" } },
  }]), /does not match catalog snapshot/);
});

test("an item snapshot can be repeated but never extended, shrunk or rewritten at the same patch", () => {
  const catalog = parseHubGameItemCatalogIndex(indexFixture, catalogUrl);
  const detail = parseHubGameItemDetail(detailFixture, detailUrl);
  const { rows } = buildHubGameItemSnapshotRows(catalog, [detail]);
  const stored = rows.map(row => ({ entity_slug: row.entitySlug, content_hash: row.contentHash }));
  assert.deepEqual(assertImmutablePatchSnapshot([], rows, "items"), { unchanged: 0 });
  assert.deepEqual(assertImmutablePatchSnapshot(stored, rows, "items"), { unchanged: rows.length });
  assert.throws(() => assertImmutablePatchSnapshot(stored.slice(1), rows, "items"), /immutable items snapshot: new source rows:/);
  assert.throws(() => assertImmutablePatchSnapshot(stored, rows.slice(1), "items"), /immutable items snapshot: missing from source:/);
  const changed = rows.map((row, index) => index ? row : { ...row, contentHash: "corrected-source" });
  assert.throws(() => assertImmutablePatchSnapshot(stored, changed, "items"), /immutable items snapshot: changed values:/);
});
