import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHubGameRuneCatalog } from "../lib/hubGameRuneCatalog.mjs";
import {
  assertImmutableRuneSnapshot,
  buildHubGameRuneSnapshotRows,
} from "../lib/hubGameRuneSnapshots.mjs";

const fixtureUrl = new URL("./fixtures/hub-game-runes.html", import.meta.url);
const sourceUrl = "https://hub-game.com/wildrift/en/runes";
const fixture = await readFile(fixtureUrl, "utf8");

test("builds only current Hub rune snapshots and preserves declared coverage caveats", () => {
  const catalog = parseHubGameRuneCatalog(fixture, sourceUrl);
  const rows = buildHubGameRuneSnapshotRows(catalog);

  assert.equal(rows.length, 54);
  assert.equal(rows[0].patchVersion, "7.3b");
  assert.equal(rows[0].dataset, "runes");
  assert.equal(rows[0].entityKind, "rune");
  assert.equal(rows[0].sourceKind, "hub-game");
  assert.equal(rows[0].sourcePatchVersion, "7.3b");
  assert.equal(rows[0].sourceUpdatedAt, "2026-10-16");
  assert.equal(rows[0].verificationStatus, "verified");
  assert.equal(rows[0].state.source.translatedFromJapanese, true);
  assert.equal(rows[0].state.source.historicalReconstruction, "not-performed");
  assert.equal(rows[0].state.source.historyCoverage, "not-provided-on-catalog");
  assert.equal(rows[0].sourceEvidence[0].listedRuneCount, 54);
  assert.equal(rows[0].sourceEvidence[0].translatedFromJapanese, true);
  assert.equal(rows[0].sourceEvidence[0].descriptionOnlyRunes, 39);
  assert.equal(rows[0].state.slugSource, "icon-filename");
  assert.equal(rows[0].state.dataCoverage, "catalog-card-description-only");
  assert.equal(new Set(rows.map((row) => row.entitySlug)).size, 54);

  const comet = rows.find((row) => row.state.name === "Arcane Comet");
  assert.equal(comet.entitySlug, "arcane-comet");
  assert.equal(comet.state.dataCoverage, "catalog-card-with-structured-value-lines");
  assert.deepEqual(comet.state.values, [
    { label: "Damage", value: "15 - 100 (+2 per total hit on enemy champions) (+10% bonus AD, +5% AP)" },
    { label: "Cooldown", value: "16 - 8 seconds (by level)" },
  ]);
  assert.equal(comet.contentHash, buildHubGameRuneSnapshotRows(catalog).find((row) => row.entitySlug === comet.entitySlug).contentHash);
});

test("rejects incomplete, duplicate, or wrongly sourced rune catalogs before persistence", () => {
  const catalog = parseHubGameRuneCatalog(fixture, sourceUrl);
  assert.throws(() => buildHubGameRuneSnapshotRows({ ...catalog, runes: catalog.runes.slice(0, 1) }), /invalid rune count/);
  assert.throws(() => buildHubGameRuneSnapshotRows({
    ...catalog,
    source: { ...catalog.source, locale: "ru-ru" },
  }), /English catalog/);
  assert.throws(() => buildHubGameRuneSnapshotRows({
    ...catalog,
    runes: [catalog.runes[0], { ...catalog.runes[1], slug: catalog.runes[0].slug }, ...catalog.runes.slice(2)],
  }), /Duplicate Hub rune slug/);
  assert.throws(() => buildHubGameRuneSnapshotRows({
    ...catalog,
    runes: [{ ...catalog.runes[0], effectText: " " }, ...catalog.runes.slice(1)],
  }), /effectText/);
});

test("keeps persisted rune snapshots immutable and rejects partial or changed replays", () => {
  const rows = buildHubGameRuneSnapshotRows(parseHubGameRuneCatalog(fixture, sourceUrl));
  const existingRows = rows.map(({ entitySlug, contentHash }) => ({ entity_slug: entitySlug, content_hash: contentHash }));

  assert.deepEqual(assertImmutableRuneSnapshot(existingRows, rows), { unchanged: 54 });
  assert.throws(() => assertImmutableRuneSnapshot(existingRows.slice(0, 53), rows), /new source rows:/);
  assert.throws(() => assertImmutableRuneSnapshot(existingRows, rows.slice(0, 53)), /missing from source:/);
  assert.throws(() => assertImmutableRuneSnapshot(
    existingRows.map((row) => row.entity_slug === "arcane-comet" ? { ...row, content_hash: "changed" } : row),
    rows,
  ), /changed values: arcane-comet/);
});
