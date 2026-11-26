import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists champion_lore (
      champion_slug text not null,
      locale text not null,
      title text,
      short_lore text,
      official_lore text not null,
      generation_facts jsonb not null,
      source_kind text not null default 'riot-universe-page',
      source_url text not null,
      canonical_url text not null,
      content_hash text not null,
      review_status text not null default 'pending',
      imported_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (champion_slug, locale)
    );
  `;

  await client`
    alter table champion_lore
    alter column source_kind set default 'riot-universe-page';
  `;

  await client`
    alter table champion_lore
    drop column if exists source_version;
  `;

  await client`
    create index if not exists champion_lore_review_status_idx
    on champion_lore (review_status);
  `;

  await client`
    create index if not exists champion_lore_content_hash_idx
    on champion_lore (content_hash);
  `;

  console.log("champion lore table is ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
