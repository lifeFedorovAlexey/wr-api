import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists champion_guides (
      slug text primary key,
      name text not null,
      title text,
      icon text,
      patch text,
      tier text,
      recommended_role text,
      roles jsonb,
      build_count integer not null default 1,
      source_site text not null,
      source_url text,
      content_hash text,
      fetched_at timestamptz,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create index if not exists champion_guides_name_idx
    on champion_guides (name);
  `;

  await client`
    create index if not exists champion_guides_updated_at_idx
    on champion_guides (updated_at desc);
  `;

  console.log("champion_guides table is ready");
} 

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
