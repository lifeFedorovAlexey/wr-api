import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  const [snapshots, transitions, parsedPatches] = await Promise.all([
    client`
      select dataset, patch_version as "patchVersion", verification_status as "verificationStatus", count(*)::int as rows
      from patch_data_snapshots
      group by dataset, patch_version, verification_status
      order by dataset, patch_version, verification_status
    `,
    client`
      select dataset, mode, entity_kind as "entityKind", entity_slug as "entitySlug", patch_version as "patchVersion",
        verification_status as "verificationStatus", count(*)::int as rows
      from patch_data_transitions
      group by dataset, mode, entity_kind, entity_slug, patch_version, verification_status
      order by dataset, mode, entity_kind, entity_slug, patch_version, verification_status
    `,
    client`
      select locale, patch_version as "patchVersion", parse_status as "parseStatus",
        count(*)::int as articles,
        count(*) filter (where jsonb_array_length(coalesce(parsed_payload->'changes', '[]'::jsonb)) = 0)::int as "emptyParsedArticles"
      from patch_notes
      group by locale, patch_version, parse_status
      order by locale, patch_version
    `,
  ]);

  const datasets = [...new Set([
    ...snapshots.map((row) => row.dataset),
    ...transitions.map((row) => row.dataset),
  ])].sort();
  const report = {
    patchNotes: {
      storedPatchVersions: [...new Set(parsedPatches.map((row) => row.patchVersion))],
      articleStatusCounts: parsedPatches.reduce((counts, row) => {
        const key = `${row.locale}:${row.parseStatus}`;
        counts[key] = (counts[key] || 0) + row.articles;
        return counts;
      }, {}),
      emptyParsedArticles: parsedPatches
        .filter((row) => row.parseStatus === "parsed" && row.emptyParsedArticles > 0)
        .map(({ locale, patchVersion, emptyParsedArticles }) => ({ locale, patchVersion, emptyParsedArticles })),
      missingLocaleRows: [...new Set(parsedPatches.map((row) => row.patchVersion))]
        .map((patchVersion) => ({
          patchVersion,
          missingLocales: ["en-us", "ru-ru"].filter((locale) => !parsedPatches.some((row) => (
            row.patchVersion === patchVersion && row.locale === locale && row.parseStatus === "parsed"
          ))),
        }))
        .filter((row) => row.missingLocales.length),
    },
    datasets: datasets.map((dataset) => {
      const datasetSnapshots = snapshots.filter((row) => row.dataset === dataset);
      const datasetTransitions = transitions.filter((row) => row.dataset === dataset);
      const verifiedSnapshotVersions = [...new Set(datasetSnapshots
        .filter((row) => row.verificationStatus === "verified")
        .map((row) => row.patchVersion))];
      const verifiedTransitions = datasetTransitions.filter((row) => row.verificationStatus === "verified");
      const unresolvedTransitions = datasetTransitions.filter((row) => row.verificationStatus === "unresolved");
      return {
        dataset,
        verifiedSnapshots: datasetSnapshots
          .filter((row) => row.verificationStatus === "verified")
          .map(({ patchVersion, rows }) => ({ patchVersion, entities: rows })),
        verifiedTransitionRows: verifiedTransitions.reduce((sum, row) => sum + row.rows, 0),
        unresolvedTransitionRows: unresolvedTransitions.reduce((sum, row) => sum + row.rows, 0),
        entitiesWithVerifiedTransitions: new Set(verifiedTransitions.map((row) => row.entitySlug)).size,
        hasVerifiedHistoryEvidence: verifiedSnapshotVersions.length > 0 && verifiedTransitions.length > 0,
      };
    }),
    rules: [
      "A patch-note article being parsed does not make its values a verified transition.",
      "A historical chain needs an explicit verified change or reviewed no-change record for every tracked field at every patch.",
      "A source mismatch, missing version, ambiguous field, or mode mismatch stops reconstruction.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("[patch-data-history-audit] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
