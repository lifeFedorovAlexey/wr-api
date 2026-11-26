import "dotenv/config";

import { client } from "../db/client.js";

async function setupChampionStatsSnapshotTables() {
  await client`
    create table if not exists champion_stats_snapshots (
      id serial primary key,
      source text not null,
      stats_date date not null,
      status text not null,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      champion_count integer,
      matched_champion_count integer,
      row_count integer,
      missing_champion_count integer,
      metadata jsonb
    );
  `;

  await client`
    alter table champion_stats_history
    add column if not exists snapshot_id integer;
  `;

  await client`
    create index if not exists champion_stats_snapshots_source_date_idx
    on champion_stats_snapshots (source, stats_date);
  `;

  await client`
    create index if not exists champion_stats_snapshots_source_status_date_idx
    on champion_stats_snapshots (source, status, stats_date);
  `;
}

async function backfillChampionStatsSnapshots() {
  await client`
    with per_date as (
      select
        h.date as stats_date,
        min(h.created_at) as started_at,
        max(h.created_at) as completed_at,
        count(*)::integer as row_count,
        count(distinct h.slug)::integer as champion_count
      from champion_stats_history h
      group by h.date
    )
    insert into champion_stats_snapshots (
      source,
      stats_date,
      status,
      started_at,
      completed_at,
      champion_count,
      matched_champion_count,
      row_count,
      missing_champion_count,
      metadata
    )
    select
      'cnHistory',
      p.stats_date,
      case
        when p.row_count <= 0 then 'failed'
        else 'completed'
      end,
      p.started_at,
      p.completed_at,
      p.champion_count,
      p.champion_count,
      p.row_count,
      0,
      jsonb_build_object('legacyBackfill', true)
    from per_date p
    where not exists (
      select 1
      from champion_stats_snapshots s
      where s.source = 'cnHistory'
        and s.stats_date = p.stats_date
    );
  `;

  await client`
    update champion_stats_snapshots
    set status = case
      when coalesce(row_count, 0) <= 0 then 'failed'
      else 'completed'
    end
    where source = 'cnHistory'
      and coalesce(metadata->>'legacyBackfill', 'false') = 'true';
  `;

  await client`
    with canonical_snapshots as (
      select distinct on (stats_date)
        id,
        stats_date
      from champion_stats_snapshots
      where source = 'cnHistory'
      order by stats_date desc, completed_at desc nulls last, id desc
    )
    update champion_stats_history h
    set snapshot_id = c.id
    from canonical_snapshots c
    where h.snapshot_id is null
      and h.date = c.stats_date;
  `;
}

async function ensureChampionStatsIndexes() {
  await client`
    alter table champion_stats_history
    drop constraint if exists champion_stats_history_uq;
  `;

  await client`
    drop index if exists champion_stats_history_date_slug_rank_lane_uidx;
  `;

  await client`
    create unique index if not exists champion_stats_history_snapshot_slug_rank_lane_uidx
    on champion_stats_history (snapshot_id, slug, rank, lane);
  `;

  await client`
    create index if not exists champion_stats_history_date_idx
    on champion_stats_history (date);
  `;

  await client`
    create index if not exists champion_stats_history_rank_lane_date_idx
    on champion_stats_history (rank, lane, date);
  `;

  await client`
    create index if not exists champion_stats_history_snapshot_idx
    on champion_stats_history (snapshot_id);
  `;

  await client`
    create index if not exists champion_stats_history_slug_date_idx
    on champion_stats_history (slug, date);
  `;
}

async function main() {
  await setupChampionStatsSnapshotTables();
  await backfillChampionStatsSnapshots();
  await ensureChampionStatsIndexes();

  console.log("stats tables and snapshot indexes are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
