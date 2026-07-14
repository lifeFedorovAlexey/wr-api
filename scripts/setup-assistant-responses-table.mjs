import "dotenv/config";
import { client } from "../db/client.js";

await client.unsafe(`
  create table if not exists assistant_responses (
    champion_slug text not null,
    lane text not null,
    rank text not null,
    response text not null,
    stats_snapshot_id integer not null,
    lore_content_hash text not null,
    model text not null,
    generated_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (champion_slug, lane, rank)
  );
  create index if not exists assistant_responses_snapshot_idx
    on assistant_responses (stats_snapshot_id);
`);
await client.end({ timeout: 5 });
console.log("[assistant] table is ready");
