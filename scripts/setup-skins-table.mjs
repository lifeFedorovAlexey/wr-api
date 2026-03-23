import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists skin_collections (
      champion_slug text primary key,
      champion_name text not null,
      source text not null default 'merged-json',
      source_updated_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create table if not exists skin_entries (
      id serial primary key,
      champion_slug text not null,
      skin_slug text not null,
      skin_name text not null,
      sort_order integer not null default 0,
      has_3d boolean not null default false,
      image_source_url text,
      image_asset_path text,
      model_source_url text,
      model_asset_path text,
      raw_payload jsonb,
      source_updated_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create unique index if not exists skin_entries_champion_skin_uidx
    on skin_entries (champion_slug, skin_slug);
  `;

  await client`
    create index if not exists skin_entries_champion_sort_idx
    on skin_entries (champion_slug, sort_order);
  `;

  await client`
    create index if not exists skin_entries_skin_slug_idx
    on skin_entries (skin_slug);
  `;

  console.log("skin tables are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
