import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameChampionStats } from "../lib/hubGameChampionStats.mjs";
import {
  applyPatchChampionStatSnapshotCorrections,
  buildPatchChampionStatSnapshotCorrectionPlan,
} from "../lib/patchChampionStatSnapshotCorrections.mjs";
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
    growthPerLevel: parsed.champions[0].growthPerLevel,
    levelCurve: parsed.levelCurve,
    lanes: parsed.champions[0].lanes,
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
    role: "champion-stats",
    url: sourceUrl,
    sourcePatchVersion: "7.3",
    sourceUpdatedAt: "2026-09-23",
    globalPatchThrough: "7.3b",
    listedChampionCount: 3,
    levelCurve: parsed.levelCurve,
    progressionFormula: "base + growthPerLevel * sum(levelCurve[0..level-1])",
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

test("treats an effective corrected champion baseline as an unchanged sync without mutating its base rows", () => {
  const incomingRows = buildPatchChampionStatSnapshotRows(parseHubGameChampionStats(fixture, sourceUrl));
  const legacyRows = incomingRows.map((row) => {
    const {
      growthPerLevel: _growthPerLevel,
      levelCurve: _levelCurve,
      lanes: _lanes,
      ...legacyState
    } = row.state;
    const state = legacyState;
    const [evidence] = row.sourceEvidence;
    const {
      role: _role,
      listedChampionCount: _listedChampionCount,
      levelCurve: _evidenceLevelCurve,
      progressionFormula: _progressionFormula,
      ...legacyEvidence
    } = evidence;
    return {
      ...row,
      state,
      sourceEvidence: [legacyEvidence],
      contentHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    };
  });
  const plan = buildPatchChampionStatSnapshotCorrectionPlan({
    existingSnapshots: legacyRows,
    incomingRows,
  });
  const effectiveRows = applyPatchChampionStatSnapshotCorrections(
    legacyRows,
    plan.corrections.map((correction, index) => ({ ...correction, id: index + 1 })),
  );

  assert.throws(() => assertImmutablePatchSnapshot(legacyRows, incomingRows), /changed values/);
  assert.deepEqual(assertImmutablePatchSnapshot(effectiveRows, incomingRows), { unchanged: incomingRows.length });
  assert.throws(() => assertImmutablePatchSnapshot(
    effectiveRows.map((row, index) => index === 0 ? { ...row, contentHash: "corrupt" } : row),
    incomingRows,
  ), /changed values/);
  assert.deepEqual(legacyRows.map((row) => row.state), incomingRows.map((row) => {
    const { growthPerLevel: _growth, levelCurve: _curve, lanes: _lanes, ...state } = row.state;
    return state;
  }));
});

test("exposes current-baseline status and declared source dates in the patch API shape", () => {
  const parsed = parseHubGameChampionStats(fixture, sourceUrl);
  const rows = buildPatchChampionStatSnapshotRows(parsed);
  const result = buildPublicChampionStats(rows, [], "7.3b");

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
    snapshotPatchVersion: "7.3b",
    listedChampionCount: 3,
  });
  assert.equal(result.count, 3);
  assert.deepEqual(result.levelCurve, parsed.levelCurve);
  assert.equal(result.champions[0].snapshotScope, "current-baseline");
  assert.equal(result.champions[0].historicalReconstruction, "not-performed");
  assert.deepEqual(result.champions[0].statsAtLevel1, parsed.champions[0].statsAtLevel1);
  assert.deepEqual(result.champions[0].ratings, parsed.champions[0].ratings);
  assert.deepEqual(result.champions[0].growthPerLevel, parsed.champions[0].growthPerLevel);
  assert.deepEqual(result.champions[0].lanes, ["top", "jungle"]);
  assert.equal(result.champions[0].statsByLevel.length, 15);
  assert.equal(result.champions[0].statsByLevel[0].health, 630);
  assert.equal(result.champions[0].statsByLevel[4].health, 1065.2);
  assert.equal(result.champions[0].statsByLevel[14].health, 2534);
  assert.equal(result.champions[0].statsByLevel[14].mana, null);
  assert.equal(buildPublicChampionStats([], [], "7.2"), null);
});

function rowsAtPatchVersion(rows, patchVersion, {
  sourcePatchVersion = patchVersion,
  sourceUpdatedAt = "2026-09-23",
  sourceKind = rows[0].sourceKind,
  sourceUrl: baselineSourceUrl = sourceUrl,
  scope,
  historicalReconstruction,
} = {}) {
  return rows.map((row) => {
    const evidence = [{
      ...row.sourceEvidence[0],
      kind: sourceKind,
      url: baselineSourceUrl,
      sourcePatchVersion,
      sourceUpdatedAt,
      globalPatchThrough: patchVersion,
    }];
    const state = {
      ...row.state,
      source: {
        ...row.state.source,
        sourceKind,
        sourceUrl: baselineSourceUrl,
        patchVersion,
        sourcePatchVersion,
        sourceUpdatedAt,
      },
      ...(scope ? { snapshotScope: scope } : {}),
      ...(historicalReconstruction ? { historicalReconstruction } : {}),
    };
    return {
      ...row,
      patchVersion,
      sourceKind,
      sourceUrl: baselineSourceUrl,
      sourcePatchVersion,
      sourceUpdatedAt,
      sourceEvidence: evidence,
      state,
    };
  });
}

test("uses the latest verified current champion baseline for older patch detail", () => {
  const currentRows = buildPatchChampionStatSnapshotRows(parseHubGameChampionStats(fixture, sourceUrl));
  const olderRows = rowsAtPatchVersion(currentRows, "7.3a", {
    sourcePatchVersion: "7.2",
    sourceUpdatedAt: "2026-08-15",
  });
  const latestRows = rowsAtPatchVersion(currentRows, "7.3b", {
    sourcePatchVersion: "7.3",
    sourceUpdatedAt: "2026-09-23",
  });

  const result = buildPublicChampionStats([...olderRows, ...latestRows], [], "7.2");

  assert.equal(result.patchVersion, "7.2", "the API retains the requested patch as its response context");
  assert.equal(result.snapshotScope, "current-baseline");
  assert.equal(result.historicalReconstruction, "not-performed");
  assert.equal(result.count, latestRows.length);
  assert.equal(result.source.snapshotPatchVersion, "7.3b");
  assert.equal(result.source.globalPatchThrough, "7.3b");
  assert.ok(result.champions.every((champion) => champion.snapshotScope === "current-baseline"
    && champion.historicalReconstruction === "not-performed"));
});

test("uses patch-exact verified historical rows only for their own patch", () => {
  const currentRows = buildPatchChampionStatSnapshotRows(parseHubGameChampionStats(fixture, sourceUrl));
  const latestRows = rowsAtPatchVersion(currentRows, "7.3b", {
    sourcePatchVersion: "7.3",
    sourceUpdatedAt: "2026-09-23",
  });
  const historicalRows = rowsAtPatchVersion(currentRows, "7.2", {
    sourcePatchVersion: "7.2",
    sourceUpdatedAt: "2026-08-15",
    sourceKind: "riot-patch-exact-champion-stats",
    sourceUrl: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-7-2/",
    scope: "historical",
    historicalReconstruction: "reconstructed",
  });

  const matching = buildPublicChampionStats([...latestRows, ...historicalRows], [], "7.2");
  const nonMatching = buildPublicChampionStats([...latestRows, ...historicalRows], [], "7.1");

  assert.equal(matching.snapshotScope, "historical");
  assert.equal(matching.source.snapshotPatchVersion, "7.2");
  assert.equal(matching.champions[0].historicalReconstruction, "reconstructed");
  assert.equal(nonMatching.snapshotScope, "current-baseline");
  assert.equal(nonMatching.source.snapshotPatchVersion, "7.3b");
});

test("rejects incomplete or conflicting current champion baseline groups", () => {
  const currentRows = buildPatchChampionStatSnapshotRows(parseHubGameChampionStats(fixture, sourceUrl));
  const latestRows = rowsAtPatchVersion(currentRows, "7.3b", {
    sourcePatchVersion: "7.3",
    sourceUpdatedAt: "2026-09-23",
  });
  const partial = latestRows.map((row, index) => index === 0
    ? { ...row, verificationStatus: "partial" }
    : row);
  const conflictingEvidence = latestRows.map((row, index) => index === 0
    ? { ...row, sourceEvidence: [{ ...row.sourceEvidence[0], sourcePatchVersion: "7.2" }] }
    : row);
  const missingStat = latestRows.map((row, index) => index === 0
    ? { ...row, state: { ...row.state, statsAtLevel1: { ...row.state.statsAtLevel1, attack: undefined } } }
    : row);
  const truncatedRoster = latestRows.slice(0, -1);
  const wrongRosterCount = latestRows.map((row) => ({
    ...row,
    sourceEvidence: [{ ...row.sourceEvidence[0], listedChampionCount: latestRows.length + 1 }],
  }));
  const missingRosterCount = latestRows.map((row) => {
    const { listedChampionCount, ...evidence } = row.sourceEvidence[0];
    return { ...row, sourceEvidence: [evidence] };
  });

  assert.equal(buildPublicChampionStats(partial, [], "7.2"), null);
  assert.equal(buildPublicChampionStats(conflictingEvidence, [], "7.2"), null);
  assert.equal(buildPublicChampionStats(missingStat, [], "7.2"), null);
  assert.equal(buildPublicChampionStats(truncatedRoster, [], "7.2"), null);
  assert.equal(buildPublicChampionStats(wrongRosterCount, [], "7.2"), null);
  assert.equal(buildPublicChampionStats(missingRosterCount, [], "7.2"), null);
});

test("resolves patch champion names from locale catalog through Hub-to-Riot slug aliases", () => {
  const rows = buildPatchChampionStatSnapshotRows(parseHubGameChampionStats(fixture, sourceUrl));
  const snapshots = [
    { ...rows[0], entitySlug: "aurelionsol", state: { ...rows[0].state, name: "Aurelion Sol" } },
    { ...rows[1], entitySlug: "drmundo", state: { ...rows[1].state, name: "Dr. Mundo" } },
    { ...rows[2], entitySlug: "chogath", state: { ...rows[2].state, name: "Cho'Gath" } },
  ];
  const championRows = [
    {
      slug: "aurelion-sol",
      name: "Аурелион Сол",
      nameLocalizations: { ru_ru: "Аурелион Сол", en_us: "AURELION SOL" },
    },
    {
      slug: "dr-mundo",
      name: "Доктор Мундо",
      nameLocalizations: { ru_ru: "Доктор Мундо", en_us: "DR. MUNDO" },
    },
    {
      slug: "chogath",
      name: "ЧО'ГАТ",
      nameLocalizations: { ru_ru: "ЧО'ГАТ", en_us: "CHO'GATH" },
    },
  ];

  const russian = buildPublicChampionStats(snapshots, championRows, "7.3b", "ru-ru");
  assert.deepEqual(russian.champions.map(({ slug, name }) => [slug, name]), [
    ["aurelionsol", "Аурелион Сол"],
    ["drmundo", "Доктор Мундо"],
      ["chogath", "Чо'Гат"],
  ]);

  const english = buildPublicChampionStats(snapshots, championRows, "7.3b", "en-us");
  assert.deepEqual(english.champions.map(({ slug, name }) => [slug, name]), [
    ["aurelionsol", "AURELION SOL"],
    ["drmundo", "DR. MUNDO"],
    ["chogath", "CHO'GATH"],
  ]);
});
