import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "../db/client.js";
import { championStatsSnapshots } from "../db/schema.js";

export const CHAMPION_STATS_SNAPSHOT_SOURCE = "cnHistory";
export const SNAPSHOT_STATUS_RUNNING = "running";
export const SNAPSHOT_STATUS_COMPLETED = "completed";
export const SNAPSHOT_STATUS_PARTIAL = "partial";
export const SNAPSHOT_STATUS_FAILED = "failed";
export const COMPLETED_SNAPSHOT_ROW_RATIO = 0.85;

function toSnapshotView(row) {
  if (!row) return null;

  return {
    id: row.id,
    source: row.source,
    statsDate: row.statsDate,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    championCount: row.championCount,
    matchedChampionCount: row.matchedChampionCount,
    rowCount: row.rowCount,
    missingChampionCount: row.missingChampionCount,
    metadata: row.metadata || null,
  };
}

function getSnapshotDateKey(row) {
  return row?.statsDate instanceof Date
    ? row.statsDate.toISOString().slice(0, 10)
    : String(row?.statsDate || "");
}

function dedupeSnapshotsByDate(rows = [], limit = null) {
  const snapshots = [];
  const seenDates = new Set();

  for (const row of rows) {
    const key = getSnapshotDateKey(row);
    if (!key || seenDates.has(key)) continue;

    seenDates.add(key);
    snapshots.push(toSnapshotView(row));

    if (limit && snapshots.length >= limit) break;
  }

  return snapshots;
}

function buildCompletedSnapshotConditions({ fromDate = null, toDate = null } = {}) {
  const conditions = [
    eq(championStatsSnapshots.source, CHAMPION_STATS_SNAPSHOT_SOURCE),
    eq(championStatsSnapshots.status, SNAPSHOT_STATUS_COMPLETED),
  ];

  if (fromDate) {
    conditions.push(gte(championStatsSnapshots.statsDate, fromDate));
  }

  if (toDate) {
    conditions.push(lte(championStatsSnapshots.statsDate, toDate));
  }

  return conditions;
}

export function determineChampionStatsSnapshotStatus({
  rowCount,
  previousCompletedRowCount,
}) {
  const safeRowCount = Number(rowCount) || 0;
  const baseline = Number(previousCompletedRowCount) || 0;

  if (safeRowCount <= 0) {
    return SNAPSHOT_STATUS_FAILED;
  }

  if (baseline <= 0) {
    return SNAPSHOT_STATUS_COMPLETED;
  }

  return safeRowCount >= Math.floor(baseline * COMPLETED_SNAPSHOT_ROW_RATIO)
    ? SNAPSHOT_STATUS_COMPLETED
    : SNAPSHOT_STATUS_PARTIAL;
}

export async function createChampionStatsSnapshot({
  statsDate,
  startedAt = new Date(),
  metadata = null,
} = {}) {
  const [row] = await db
    .insert(championStatsSnapshots)
    .values({
      source: CHAMPION_STATS_SNAPSHOT_SOURCE,
      statsDate,
      status: SNAPSHOT_STATUS_RUNNING,
      startedAt,
      metadata,
    })
    .returning();

  return toSnapshotView(row);
}

export async function updateChampionStatsSnapshot(snapshotId, patch = {}) {
  const [row] = await db
    .update(championStatsSnapshots)
    .set(patch)
    .where(eq(championStatsSnapshots.id, snapshotId))
    .returning();

  return toSnapshotView(row);
}

export async function getLatestCompletedChampionStatsSnapshot() {
  const [row] = await db
    .select()
    .from(championStatsSnapshots)
    .where(
      and(
        eq(championStatsSnapshots.source, CHAMPION_STATS_SNAPSHOT_SOURCE),
        eq(championStatsSnapshots.status, SNAPSHOT_STATUS_COMPLETED),
      ),
    )
    .orderBy(
      desc(championStatsSnapshots.statsDate),
      desc(championStatsSnapshots.completedAt),
      desc(championStatsSnapshots.id),
    )
    .limit(1);

  return toSnapshotView(row);
}

export async function listRecentCompletedChampionStatsSnapshotsByDate(limit = 30) {
  const rows = await listCompletedChampionStatsSnapshotsByDateRange({
    limit: Math.max(limit * 4, limit),
  });
  return dedupeSnapshotsByDate(rows, limit);
}

export async function listCompletedChampionStatsSnapshotsByDateRange({
  fromDate = null,
  toDate = null,
  limit = null,
} = {}) {
  let query = db
    .select()
    .from(championStatsSnapshots)
    .where(and(...buildCompletedSnapshotConditions({ fromDate, toDate })))
    .orderBy(
      desc(championStatsSnapshots.statsDate),
      desc(championStatsSnapshots.completedAt),
      desc(championStatsSnapshots.id),
    );

  if (limit && Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const rows = await query;
  return dedupeSnapshotsByDate(rows, limit);
}
