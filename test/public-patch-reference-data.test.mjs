import test from "node:test";
import assert from "node:assert/strict";

import { buildPublicPatchReferenceData } from "../lib/publicPatchReferenceData.mjs";

function snapshot({
  dataset = "runes",
  patchVersion = "7.3b",
  sourceUpdatedAt = "2026-10-16",
  entitySlug = "summon-aery",
  name = "Summon Aery",
  scope = "current-baseline",
  sourcePatchVersion = "7.3b",
  sourceUrl = `https://hub-game.com/wildrift/en/${dataset}`,
  listedRuneCount = 1,
  listedSpellCount = 1,
} = {}) {
  const role = dataset === "runes" ? "rune-catalog" : "summoner-spell-catalog";
  return {
    dataset,
    patchVersion,
    entitySlug,
    state: {
      name,
      image: `https://hub-game.com/${entitySlug}.png`,
      snapshotScope: scope,
      historicalReconstruction: scope === "current-baseline" ? "not-performed" : "reconstructed",
      source: { sourceLocale: "en" },
      values: [{ label: "Damage", value: "10" }],
      mechanicsFacts: [{ propertyPath: "damage", value: 10 }],
      mechanicsCoverage: { status: "verified", complete: true },
    },
    verificationStatus: "verified",
    sourceKind: "hub-game",
    sourceUrl,
    sourcePatchVersion,
    sourceUpdatedAt,
    sourceEvidence: [{
      kind: "hub-game",
      role,
      url: sourceUrl,
      sourcePatchVersion,
      sourceUpdatedAt,
      listedRuneCount,
      listedSpellCount,
      coverage: { total: 1 },
    }],
  };
}

test("projects latest current baseline and preserves its non-historical scope", () => {
  const older = snapshot({ sourceUpdatedAt: "2026-10-01", entitySlug: "older-rune" });
  const newer = snapshot({ entitySlug: "summon-aery" });
  const reconstructed = snapshot({
    patchVersion: "7.4",
    sourceUpdatedAt: "2026-10-20",
    entitySlug: "future-replay",
    scope: "historical",
    sourcePatchVersion: "7.4",
  });

  const result = buildPublicPatchReferenceData([older, newer, reconstructed], "runes");

  assert.equal(result.patchVersion, "7.3b");
  assert.equal(result.snapshotScope, "current-baseline");
  assert.equal(result.historicalReconstruction, "not-performed");
  assert.equal(result.count, 1);
  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.catalogCoverage.complete, true);
  assert.equal(result.catalogCoverage.cutoffConfirmed, true);
  assert.deepEqual(result.entries.map((entry) => entry.slug), ["summon-aery"]);
  assert.equal(result.source.locale, "en");
});

test("attaches reference snapshots to the requested patch without changing their baseline scope", () => {
  const spellRows = [snapshot({
    dataset: "summoner-spells",
    patchVersion: "baseline-2026-09-30",
    sourceUpdatedAt: "2026-09-30",
    entitySlug: "flash",
    name: "Flash",
    sourcePatchVersion: null,
    sourceUrl: "https://hub-game.com/wildrift/en/spells",
    listedSpellCount: 1,
  })];
  spellRows[0].sourceEvidence[0].patchCoverage = { status: "unconfirmed", throughPatch: null };

  const result = buildPublicPatchReferenceData(spellRows, "summoner-spells", [], "7.2");

  assert.equal(result.patchVersion, "baseline-2026-09-30");
  assert.equal(result.requestedPatchVersion, "7.2");
  assert.equal(result.snapshotScope, "current-baseline");
  assert.equal(result.historicalReconstruction, "not-performed");
  assert.equal(result.historyCoverage, "not-provided-on-catalog");
  assert.equal(result.source.patchCoverage.status, "unconfirmed");
  assert.equal(result.source.historyCoverage, "not-provided-on-catalog");
  assert.equal(result.source.sourcePatchVersion, null);
  assert.equal(result.verificationStatus, "partial");
  assert.deepEqual(result.catalogCoverage, {
    listedEntityCount: 1,
    snapshotRowCount: 1,
    complete: true,
    verificationStatus: "partial",
    cutoffConfirmed: false,
  });
});

test("returns null when there is no explicitly current snapshot", () => {
  assert.equal(buildPublicPatchReferenceData([
    snapshot({ scope: "historical" }),
  ], "runes"), null);
  assert.equal(buildPublicPatchReferenceData([], "summoner-spells"), null);
});

test("rejects mixed source metadata within one current snapshot", () => {
  const first = snapshot();
  const conflict = snapshot({ entitySlug: "another-rune", sourceUrl: "https://example.com" });

  assert.throws(
    () => buildPublicPatchReferenceData([first, conflict], "runes"),
    /Mixed source metadata in runes current snapshot/,
  );
});

test("rejects rune catalogs whose declared count or entity slugs are incomplete", () => {
  const first = snapshot({ listedRuneCount: 2 });
  const second = snapshot({ entitySlug: "summon-aery-2", listedRuneCount: 2 });

  assert.equal(buildPublicPatchReferenceData([first], "runes"), null);
  assert.equal(buildPublicPatchReferenceData([
    first,
    { ...second, sourceEvidence: [{ ...second.sourceEvidence[0], listedRuneCount: 3 }] },
  ], "runes"), null);
  assert.throws(() => buildPublicPatchReferenceData([
    first,
    { ...second, entitySlug: first.entitySlug },
  ], "runes"), /Duplicate snapshot identity/);
  const { listedRuneCount, ...incompleteEvidence } = first.sourceEvidence[0];
  assert.equal(buildPublicPatchReferenceData([
    { ...first, sourceEvidence: [incompleteEvidence] },
  ], "runes"), null);
});

test("projects rune catalogs when source evidence confirms the complete unique roster", () => {
  const first = snapshot({ listedRuneCount: 2 });
  const second = snapshot({ entitySlug: "phase-rush", listedRuneCount: 2 });

  const result = buildPublicPatchReferenceData([first, second], "runes");

  assert.equal(result.count, 2);
  assert.deepEqual(result.entries.map(({ slug }) => slug), ["phase-rush", "summon-aery"]);
  assert.equal(result.verificationStatus, "verified");
  assert.equal(result.sourceExtractionStatus, "verified");
  assert.equal(result.identityVerificationStatus, "verified");
  assert.deepEqual(result.mechanicsCoverage, {
    status: "verified",
    complete: true,
    totalRuneCount: 2,
    sourceValueLineRuneCount: 2,
    descriptionOnlyRuneCount: 0,
    normalizedMechanicsRuneCount: 2,
    normalizedNumericFactCount: 2,
    numericFactsDerived: 0,
  });
});

test("marks rune mechanics partial separately from verified extraction and identity", () => {
  const withStructuredMechanics = snapshot({ listedRuneCount: 3 });
  const sourceValuesOnly = snapshot({ entitySlug: "arcane-comet", listedRuneCount: 3 });
  delete sourceValuesOnly.state.mechanicsFacts;
  delete sourceValuesOnly.state.mechanicsCoverage;
  const descriptionOnly = snapshot({ entitySlug: "botanist", listedRuneCount: 3 });
  descriptionOnly.state.values = [];
  delete descriptionOnly.state.mechanicsFacts;
  delete descriptionOnly.state.mechanicsCoverage;

  const result = buildPublicPatchReferenceData([
    withStructuredMechanics,
    sourceValuesOnly,
    descriptionOnly,
  ], "runes");

  assert.equal(result.verificationStatus, "partial");
  assert.equal(result.sourceExtractionStatus, "verified");
  assert.equal(result.identityVerificationStatus, "verified");
  assert.deepEqual(result.mechanicsCoverage, {
    status: "partial",
    complete: false,
    totalRuneCount: 3,
    sourceValueLineRuneCount: 2,
    descriptionOnlyRuneCount: 1,
    normalizedMechanicsRuneCount: 1,
    normalizedNumericFactCount: 1,
    numericFactsDerived: 0,
  });

  const projectedSourceValuesOnly = result.entries.find(({ slug }) => slug === "arcane-comet");
  assert.equal(projectedSourceValuesOnly.verificationStatus, "partial");
  assert.equal(projectedSourceValuesOnly.sourceExtractionStatus, "verified");
  assert.equal(projectedSourceValuesOnly.identityVerificationStatus, "verified");
  assert.equal(projectedSourceValuesOnly.mechanicsCoverageStatus, "source-values-only");

  const projectedDescriptionOnly = result.entries.find(({ slug }) => slug === "botanist");
  assert.equal(projectedDescriptionOnly.mechanicsCoverageStatus, "description-only");
  assert.equal(projectedDescriptionOnly.verificationStatus, "partial");
});
