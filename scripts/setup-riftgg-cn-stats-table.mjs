import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists riftgg_cn_dictionaries (
      id serial primary key,
      kind text not null,
      slug text not null,
      name text not null,
      raw_payload jsonb not null,
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create table if not exists riftgg_cn_matchups (
      id serial primary key,
      champion_slug text not null,
      rank text not null,
      lane text not null,
      data_date date,
      opponent_slug text not null,
      win_rate double precision,
      pick_rate double precision,
      win_rate_rank integer,
      pick_rate_rank integer,
      raw_payload jsonb not null,
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create table if not exists riftgg_cn_builds (
      id serial primary key,
      champion_slug text not null,
      rank text not null,
      lane text not null,
      data_date date,
      build_type text not null,
      build_key text not null,
      entry_slugs text[] not null,
      win_rate double precision,
      pick_rate double precision,
      win_rate_rank integer,
      pick_rate_rank integer,
      raw_payload jsonb not null,
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create unique index if not exists riftgg_cn_dictionaries_kind_slug_uidx
    on riftgg_cn_dictionaries (kind, slug);
  `;

  await client`
    create index if not exists riftgg_cn_dictionaries_kind_idx
    on riftgg_cn_dictionaries (kind);
  `;

  await client`
    create index if not exists riftgg_cn_matchups_champion_filter_idx
    on riftgg_cn_matchups (champion_slug, rank, lane);
  `;

  await client`
    create unique index if not exists riftgg_cn_matchups_champion_opponent_uidx
    on riftgg_cn_matchups (champion_slug, rank, lane, data_date, opponent_slug);
  `;

  await client`
    create index if not exists riftgg_cn_builds_champion_type_idx
    on riftgg_cn_builds (champion_slug, build_type, rank, lane);
  `;

  await client`
    create unique index if not exists riftgg_cn_builds_champion_build_uidx
    on riftgg_cn_builds (champion_slug, rank, lane, data_date, build_type, build_key);
  `;

  console.log("riftgg cn stats tables are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
