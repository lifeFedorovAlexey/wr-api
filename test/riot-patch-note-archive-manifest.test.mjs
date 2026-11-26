import assert from "node:assert/strict";
import test from "node:test";

import { buildValidatedRiotPatchArchiveManifest } from "../lib/riotPatchNoteArchiveManifest.mjs";

function page(version, path, extra = {}) {
  return {
    version,
    url: `https://wildrift.leagueoflegends.com/en-us/news/game-updates/${path}`,
    status: "parsed",
    locale: "en-us",
    ...extra,
  };
}

function report() {
  const riotEnPages = [
    page("2.0", "wild-rift-patch-notes-2-0/"),
    page("1.0", "wild-rift-patch-notes-1-0/"),
  ];
  const riotDirectFallbackPages = [page("0.0-beta", "wild-rift-closed-beta-patch-notes")];
  return {
    generatedAt: "2026-10-17T12:00:00.000Z",
    mode: "offline-cache",
    sourceIndexes: { riotEn: { count: 2, uniqueVersions: 2 } },
    riot: { "en-us": { indexed: 2, parsed: 2, failed: 0 } },
    riotEnPages,
    riotDirectFallback: { indexed: 1, parsed: 1, failed: 0 },
    riotDirectFallbackPages,
    coverage: {
      rpnVersionsNotInRiotEnIndex: ["0.0-beta"],
      rpnVersionsWithoutValidatedRiotSource: [],
    },
  };
}

test("builds a complete ordered manifest from parsed Riot index and recovered Riot sources", () => {
  const manifest = buildValidatedRiotPatchArchiveManifest(report());

  assert.equal(manifest.complete, true);
  assert.equal(manifest.versions.length, 3);
  assert.deepEqual(manifest.versions.map(({ version }) => version), ["2.0", "1.0", "0.0-beta"]);
  assert.deepEqual(manifest.versions.map(({ source }) => source), ["Riot English index", "Riot English index", "validated direct Riot source"]);
});

test("does not declare the archive complete when an indexed Riot page failed parsing", () => {
  const input = report();
  input.riotEnPages[0].status = "failed";
  input.riot["en-us"].parsed = 1;
  input.riot["en-us"].failed = 1;

  assert.throws(() => buildValidatedRiotPatchArchiveManifest(input), /was not parsed/);
});

test("does not declare the archive complete when an RPN-only version has no validated Riot source", () => {
  const input = report();
  input.coverage.rpnVersionsWithoutValidatedRiotSource = [{ version: "0.0-beta" }];

  assert.throws(() => buildValidatedRiotPatchArchiveManifest(input), /no validated Riot source/);
});
