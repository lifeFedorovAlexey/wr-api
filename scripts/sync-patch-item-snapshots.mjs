import "dotenv/config";

import { client } from "../db/client.js";
import { parseHubGameItemDetail } from "../lib/hubGameItemDetail.mjs";
import {
  buildHubGameItemSnapshotRows,
  parseHubGameItemCatalogIndex,
} from "../lib/hubGameItemSnapshots.mjs";

const SOURCE_URL = "https://hub-game.com/wildrift/en/items";
const REQUEST_TIMEOUT_MS = Math.max(1_000, Number(process.env.HUB_ITEM_SNAPSHOT_TIMEOUT_MS || 30_000));
const REQUEST_RETRIES = Math.max(0, Math.min(5, Number(process.env.HUB_ITEM_SNAPSHOT_FETCH_RETRIES || 2)));
const REQUEST_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.HUB_ITEM_SNAPSHOT_CONCURRENCY || 8)));

async function fetchPage(url) {
  let lastError;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "WildRiftAllStats patch item baseline sync/1.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`Hub Game returned HTTP ${response.status} for ${url}`);
        if (response.status >= 500 && attempt < REQUEST_RETRIES) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
        throw error;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error(`Hub Game returned non-HTML content for ${url}: ${contentType}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= REQUEST_RETRIES || error.message.includes("HTTP 4")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error(`Hub Game fetch failed: ${url}`);
}

async function fetchDetailPages(detailLinks) {
  const results = new Array(detailLinks.length);
  const failures = [];
  let nextIndex = 0;
  const workerCount = Math.min(REQUEST_CONCURRENCY, detailLinks.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= detailLinks.length) return;
      const link = detailLinks[index];
      try {
        const html = await fetchPage(link.url);
        results[index] = parseHubGameItemDetail(html, link.url);
      } catch (error) {
        failures.push({ url: link.url, message: error.message });
      }
    }
  }));
  return { pages: results.filter(Boolean), failures: failures.sort((a, b) => a.url.localeCompare(b.url)) };
}

async function upsertImmutableSnapshotRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Hub item sync produced no snapshot rows");
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
        throw new Error(`Hub item snapshot row ${index + 1} has no ${field}`);
      }
    }
    if (!record.state || typeof record.state !== "object" || Array.isArray(record.state)) {
      throw new Error(`Hub item snapshot row ${index + 1} has invalid state`);
    }
    if (!Array.isArray(record.source_evidence)) {
      throw new Error(`Hub item snapshot row ${index + 1} has invalid source_evidence`);
    }
    return record;
  });
  const recordsJson = JSON.stringify(records);
  const insertedRows = await client.begin(async (transaction) => {
    const conflicts = await transaction`
      select incoming.entity_slug
      from jsonb_to_recordset(${recordsJson}::jsonb) as incoming (
        patch_version text, dataset text, entity_slug text, content_hash text
      )
      join patch_data_snapshots existing
        on existing.patch_version = incoming.patch_version
        and existing.dataset = incoming.dataset
        and existing.entity_slug = incoming.entity_slug
      where existing.content_hash <> incoming.content_hash
      order by incoming.entity_slug
    `;
    if (conflicts.length) {
      throw new Error(
        `Refusing to overwrite immutable items snapshot ${records[0].patch_version}; `
        + `source values changed for: ${conflicts.map((row) => row.entity_slug).join(", ")}. `
        + "Review the source and add an explicit correction record.",
      );
    }
    return transaction`
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
  });
  return { inserted: insertedRows.length, unchangedExisting: records.length - insertedRows.length };
}

async function main() {
  const catalogHtml = await fetchPage(SOURCE_URL);
  const catalog = parseHubGameItemCatalogIndex(catalogHtml, SOURCE_URL);
  const { pages, failures } = await fetchDetailPages(catalog.detailLinks);
  if (failures.length) {
    console.error(JSON.stringify({
      sourceUrl: SOURCE_URL,
      patchVersion: catalog.version,
      sourceUpdatedAt: catalog.date,
      catalogItemCount: catalog.count,
      linkedDetailPageCount: catalog.detailLinks.length,
      parsedDetailPageCount: pages.length,
      failures,
    }, null, 2));
    throw new Error(`Hub item sync stopped before database writes: ${failures.length} linked detail page(s) failed`);
  }

  const { rows, coverage } = buildHubGameItemSnapshotRows(catalog, pages);
  const storage = await upsertImmutableSnapshotRows(rows);
  console.log(JSON.stringify({
    sourceUrl: SOURCE_URL,
    dataset: rows[0]?.dataset || "items",
    ...coverage,
    verifiedRows: rows.filter((row) => row.verificationStatus === "verified").length,
    partialRows: rows.filter((row) => row.verificationStatus === "partial").length,
    detailPagesWithParsedNumericHistory: pages.filter((item) => item.history.length > 0).length,
    parsedNumericHistoryEntryCount: pages.reduce((sum, item) => sum + item.history.length, 0),
    inserted: storage.inserted,
    unchangedExisting: storage.unchangedExisting,
    failures: [],
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[patch-item-snapshots] sync failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
