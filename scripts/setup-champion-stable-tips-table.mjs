import "dotenv/config";
import { client } from "../db/client.js";

await client.unsafe(`
  create table if not exists champion_stable_tips (
    id serial primary key,
    champion_slug text not null,
    lane text,
    tip_text text not null,
    source_kind text not null,
    source_url text not null,
    source_label text,
    evidence_text text not null,
    patch_dependent boolean not null default false,
    review_status text not null default 'pending',
    content_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists champion_stable_tips_hash_uidx on champion_stable_tips (champion_slug, content_hash);
  create index if not exists champion_stable_tips_lookup_idx on champion_stable_tips (champion_slug, review_status);
`);
await client.end({ timeout: 5 });
console.log("[stable-tips] table is ready");
