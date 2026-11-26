import "dotenv/config";

import { client } from "../db/client.js";
import { parseRiftPatchNotesCounts } from "../lib/riftPatchNotesCounts.mjs";

const REFERENCE_URL = "https://www.riftpatchnotes.com/patches";
const requestedVersion = process.argv
  .find((argument) => argument.startsWith("--patch-version="))
  ?.slice("--patch-version=".length)
  .trim()
  .toLowerCase();
if (requestedVersion && !/^\d+\.\d+(?:[a-z]|-[a-z]+)?$/i.test(requestedVersion)) {
  throw new Error(`Invalid --patch-version value: ${requestedVersion}`);
}

async function main() {
  const response = await fetch(REFERENCE_URL, {
    headers: { "user-agent": "WildRiftAllStatsPatchNotesAudit/1.0" },
    signal: AbortSignal.timeout(Number(process.env.PATCH_NOTES_AUDIT_TIMEOUT_MS || 20000)),
  });
  if (!response.ok) throw new Error(`RiftPatchNotes returned HTTP ${response.status}`);
  const referenceRows = parseRiftPatchNotesCounts(await response.text());
  const [parsedVersions, localGroups] = await Promise.all([
    client`
      select distinct patch_version as "patchVersion"
      from patch_notes
      where locale = 'en-us' and parse_status = 'parsed'
      order by patch_version
    `,
    client`
      select patch_version as "patchVersion", change_type as "changeType", count(*)::int as entities
      from patch_note_changes
      where locale = 'en-us' and entity_kind = 'champion'
      group by patch_version, change_type
    `,
  ]);

  const localCounts = new Map(parsedVersions.map(({ patchVersion }) => [patchVersion, {
    buff: 0,
    nerf: 0,
    other: 0,
  }]));
  for (const row of localGroups) {
    const counts = localCounts.get(row.patchVersion);
    if (!counts) continue;
    if (row.changeType === "buff") counts.buff += row.entities;
    else if (row.changeType === "nerf") counts.nerf += row.entities;
    else counts.other += row.entities;
  }

  const filteredReference = referenceRows.filter((row) => !requestedVersion || row.patchVersion === requestedVersion);
  const filteredLocalVersions = [...localCounts.keys()].filter((version) => !requestedVersion || version === requestedVersion);
  const referenceByVersion = new Map(filteredReference.map((row) => [row.patchVersion, row]));
  const comparisons = filteredReference.map((reference) => {
    const actual = localCounts.get(reference.patchVersion);
    if (!actual) return { patchVersion: reference.patchVersion, status: "missing-local-patch", expected: reference.counts };
    const actualTotal = actual.buff + actual.nerf + actual.other;
    const entityCountMatches = actualTotal === reference.totalChampions;
    const classificationMatches = ["buff", "nerf", "other"].every((key) => actual[key] === reference.counts[key]);
    const matches = entityCountMatches && classificationMatches;
    return {
      patchVersion: reference.patchVersion,
      status: matches ? "match" : entityCountMatches ? "classification-mismatch" : "entity-count-mismatch",
      entityCountMatches,
      classificationMatches,
      expected: { ...reference.counts, total: reference.totalChampions },
      parsed: { ...actual, total: actualTotal },
    };
  });
  const parsedVersionsWithoutReference = filteredLocalVersions.filter((version) => !referenceByVersion.has(version));
  const overlap = comparisons.filter((row) => row.status !== "missing-local-patch");

  console.log(JSON.stringify({
    source: {
      name: "RiftPatchNotes patch index",
      url: REFERENCE_URL,
      scope: "Champion entity counts only. Reference classifications are an external audit signal, not canonical game data.",
    },
    coverage: {
      referencePatchVersions: filteredReference.length,
      parsedPatchVersions: filteredLocalVersions.length,
      overlappingPatchVersions: overlap.length,
      matchingPatchVersions: overlap.filter((row) => row.status === "match").length,
      entityCountMismatches: overlap.filter((row) => row.status === "entity-count-mismatch").length,
      classificationMismatches: overlap.filter((row) => row.status === "classification-mismatch").length,
      referenceVersionsMissingLocally: comparisons.filter((row) => row.status === "missing-local-patch").map((row) => row.patchVersion),
      parsedVersionsWithoutReference,
    },
    comparisons,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[patch-note-count-audit] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
