import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameChampionStats } from "../lib/hubGameChampionStats.mjs";
import {
  assertImmutablePatchSnapshot,
  buildPatchChampionStatSnapshotRows,
  buildPublicChampionStats,
} from "../lib/patchChampionStatSnapshots.mjs";

const sourceUrl = "https://hub-game.com/wildrift/en/champions/stats";
const fixture = await readFile(new URL("./fixtures/hub-game-champion-stats.html", import.meta.url), "utf8");

test("builds verified snapshot rows only for Hub's declared global-through patch", () => {
  const parsed = parseHubGameChampionStats(fixture, sourceUrl);
  const rows = buildPatchChampionStatSnapshotRows(parsed);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(({ patchVersion, dataset, entityKind, entitySlug }) => [
    patchVersion, dataset, entityKind, entitySlug,
  ]), [
    ["7.3b", "champion-base-stats", "champion", "aatrox"],
    ["7.3b", "champion-base-stats", "champion", "ahri"],
    ["7.3b", "champion-base-stats", "champion", "garen"],
  ]);
  assert.equal(rows[0].sourceKind, "hub-game-champion-stats-baseline");
  assert.equal(rows[0].sourceUrl, sourceUrl);
  assert.equal(rows[0].sourcePatchVersion, "7.3");
  assert.equal(rows[0].sourceUpdatedAt, "2026-09-23");
  assert.equal(rows[0].verificationStatus, "verified");
  assert.deepEqual(rows[0].state, {
    name: "Aatrox",
    hubSlug: "Aatrox",
    statsAtLevel1: parsed.champions[0].statsAtLevel1,
    ratings: parsed.champions[0].ratings,
    source: {
      sourceKind: "hub-game-champion-stats-baseline",
      sourceUrl,
      patchVersion: "7.3b",
      sourcePatchVersion: "7.3",
      sourceUpdatedAt: "2026-09-23",
    },
  });
  assert.equal(rows[0].contentHash, buildPatchChampionStatSnapshotRows(parsed)[0].contentHash);
  assert.deepEqual(rows[0].sourceEvidence[0], {
    kind: "hub-game-champion-stats-baseline",
    url: sourceUrl,
    sourcePatchVersion: "7.3",
    sourceUpdatedAt: "2026-09-23",
    globalPatchThrough: "7.3b",
  });
});

test("rejects malformed baseline rows and duplicate slugs before any DB write", () => {
  const parsed = parseHubGameChampionStats(fixture, sourceUrl);
  assert.throws(() => buildPatchChampionStatSnapshotRows({ ...parsed, baselineKind: "history" }), /current Hub global champion stats baseline/);
  assert.throws(() => buildPatchChampionStatSnapshotRows({ ...parsed, champions: parsed.champions.slice(0, 1) }), /invalid champion roster/);
  assert.throws(() => buildPatchChampionStatSnapshotRows({
    ...parsed,
    champions: [parsed.champions[0], { ...parsed.champions[1], slug: parsed.champions[0].slug }, parsed.champions[2]],
  }), /Duplicate champion slug/);
});

test("keeps persisted patch snapshots immutable and rejects partial or changed replays", () => {
  const rows = buildPatchChampionStatSnapshotRows(parseHubGameChampionStats(fixture, sourceUrl));
  const existingRows = rows.map(({ entitySlug, contentHash }) => ({ entity_slug: entitySlug, content_hash: contentHash }));

  assert.deepEqual(assertImmutablePatchSnapshot(existingRows, rows), { unchanged: 3 });
  assert.throws(() => assertImmutablePatchSnapshot(existingRows.slice(0, 2), rows), /new source rows: garen/);
  assert.throws(() => assertImmutablePatchSnapshot(existingRows, rows.slice(0, 2)), /missing from source: garen/);
  assert.throws(() => assertImmutablePatchSnapshot(
    existingRows.map((row) => row.entity_slug === "ahri" ? { ...row, content_hash: "changed" } : row),
    rows,
  ), /changed values: ahri/);
});

test("exposes current-baseline status and declared source dates in the patch API shape", () => {
  const rows = buildPatchChampionStatSnapshotRows(parseHubGameChampionStats(fixture, sourceUrl));
  const result = buildPublicChampionStats(rows.map((row) => ({
    entitySlug: row.entitySlug,
    state: row.state,
    verificationStatus: row.verificationStatus,
    sourceKind: row.sourceKind,
    sourceUrl: row.sourceUrl,
    sourcePatchVersion: row.sourcePatchVersion,
    sourceUpdatedAt: row.sourceUpdatedAt,
  })), [], "7.3b");

  assert.equal(result.snapshotScope, "current-baseline");
  assert.equal(result.historicalReconstruction, "not-performed");
  assert.deepEqual(result.source, {
    kind: "hub-game-champion-stats-baseline",
    url: sourceUrl,
    sourcePatchVersion: "7.3",
    sourceUpdatedAt: "2026-09-23",
    declaredBase: "Tencent China champion library",
    chinaLibraryPatch: "7.3",
    chinaLibraryAsOf: "2026-09-23",
    globalPatchThrough: "7.3b",
  });
  assert.equal(result.champions[0].snapshotScope, "current-baseline");
  assert.equal(result.champions[0].historicalReconstruction, "not-performed");
  assert.equal(buildPublicChampionStats([], [], "7.2"), null);
});
