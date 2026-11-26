import "dotenv/config";

import { client } from "../db/client.js";
import { parseHubGameChampionStats } from "../lib/hubGameChampionStats.mjs";
import {
  assertImmutablePatchSnapshot,
  buildPatchChampionStatSnapshotRows,
} from "../lib/patchChampionStatSnapshots.mjs";

const SOURCE_URL = "https://hub-game.com/wildrift/en/champions/stats";
const REQUEST_TIMEOUT_MS = Math.max(1_000, Number(process.env.HUB_CHAMPION_STATS_TIMEOUT_MS || 30_000));

async function fetchSourcePage() {
  const response = await fetch(SOURCE_URL, {
    headers: { "user-agent": "WildRiftAllStats patch data sync/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Hub Game champion stats returned HTTP ${response.status}`);
  return response.text();
}

async function upsertSnapshotRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Hub champion stats sync produced no snapshot rows");
  }
  const records = rows.map((row, index) => {
    const record = {
      patch_version: row.patchVersion,
      dataset: row.dataset,
      entity_kind: row.entityKind,
      entity_slug: row.entitySlug,
      state: row.state,
      source_kind: row.sourceKind,
      source_url: row.sourceUrl,
      source_patch_version: row.sourcePatchVersion,
      source_updated_at: row.sourceUpdatedAt,
      verification_status: row.verificationStatus,
      source_evidence: row.sourceEvidence,
      content_hash: row.contentHash,
    };
    for (const field of [
      "patch_version", "dataset", "entity_kind", "entity_slug", "source_kind", "source_url",
      "source_patch_version", "source_updated_at", "verification_status", "content_hash",
    ]) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        throw new Error(`Hub champion stats snapshot row ${index + 1} has no ${field}`);
      }
    }
    if (!record.state || typeof record.state !== "object" || Array.isArray(record.state)) {
      throw new Error(`Hub champion stats snapshot row ${index + 1} has invalid state`);
    }
    if (!Array.isArray(record.source_evidence)) {
      throw new Error(`Hub champion stats snapshot row ${index + 1} has invalid source_evidence`);
    }
    return record;
  });
  const recordsJson = JSON.stringify(records);
  const inserted = await client.begin(async (transaction) => {
    await transaction`
      select pg_advisory_xact_lock(hashtext(${records[0].dataset}), hashtext(${records[0].patch_version}))
    `;
    const existingBeforeInsert = await transaction`
      select entity_slug, content_hash
      from patch_data_snapshots
      where patch_version = ${records[0].patch_version} and dataset = ${records[0].dataset}
      order by entity_slug
      for update
    `;
    assertImmutablePatchSnapshot(existingBeforeInsert, rows);
    const insertedRows = await transaction`
      insert into patch_data_snapshots (
        patch_version, dataset, entity_kind, entity_slug, state, source_kind, source_url,
        source_patch_version, source_updated_at, verification_status, source_evidence,
        content_hash, updated_at
      )
      select
        patch_version, dataset, entity_kind, entity_slug, state, source_kind, source_url,
        source_patch_version, source_updated_at::date, verification_status, source_evidence,
        content_hash, now()
      from jsonb_to_recordset(${recordsJson}::jsonb) as row_data (
        patch_version text,
        dataset text,
        entity_kind text,
        entity_slug text,
        state jsonb,
        source_kind text,
        source_url text,
        source_patch_version text,
        source_updated_at text,
        verification_status text,
        source_evidence jsonb,
        content_hash text
      )
      on conflict (patch_version, dataset, entity_slug) do nothing
      returning entity_slug
    `;
    if (insertedRows.length !== 0 && insertedRows.length !== rows.length) {
      throw new Error(
        `Only ${insertedRows.length} of ${rows.length} champion snapshots were inserted. `
        + "The transaction will roll back; inspect concurrent writes and retry.",
      );
    }
    const existingAfterInsert = await transaction`
      select entity_slug, content_hash
      from patch_data_snapshots
      where patch_version = ${records[0].patch_version} and dataset = ${records[0].dataset}
      order by entity_slug
    `;
    assertImmutablePatchSnapshot(existingAfterInsert, rows);
    return insertedRows.length;
  });
  return { inserted, unchangedExisting: records.length - inserted };
}

async function main() {
  const html = await fetchSourcePage();
  const parsed = parseHubGameChampionStats(html, SOURCE_URL);
  const rows = buildPatchChampionStatSnapshotRows(parsed);
  const syncResult = await upsertSnapshotRows(rows);
  console.log(JSON.stringify({
    sourceUrl: SOURCE_URL,
    patchVersion: parsed.globalPatchThrough,
    sourcePatchVersion: parsed.chinaLibraryPatch,
    sourceUpdatedAt: parsed.chinaLibraryAsOf,
    dataset: rows[0]?.dataset || "champion-base-stats",
    snapshotScope: "current-baseline",
    historicalReconstruction: "not-performed",
    verified: rows.length,
    inserted: syncResult.inserted,
    unchangedExisting: syncResult.unchangedExisting,
    historicalVersionsCreated: 0,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[patch-champion-stats] sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
