import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists guide_summaries (
      slug text primary key,
      name text not null,
      title text,
      icon text,
      patch text,
      tier text,
      recommended_role text,
      roles text[],
      build_count integer not null default 1,
      source_site text not null,
      source_url text,
      content_hash text,
      fetched_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create table if not exists guide_entities (
      id serial primary key,
      kind text not null,
      slug text not null,
      name text not null,
      image_url text,
      lane text,
      entity_id integer,
      entity_kind text,
      video_url text,
      tooltip_title text,
      tooltip_cost text,
      tooltip_image_url text,
      tooltip_stats text[],
      tooltip_lines text[],
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create table if not exists guide_official_meta (
      guide_slug text primary key,
      champion_name text,
      champion_title text,
      roles text[],
      difficulty text,
      hero_remote_video_url text,
      hero_local_video_path text
    );
  `;

  await client`
    create table if not exists guide_abilities (
      id serial primary key,
      guide_slug text not null,
      order_index integer not null,
      ability_slug text not null,
      name text not null,
      subtitle text,
      description text,
      icon_url text,
      video_url text
    );
  `;

  await client`
    create table if not exists guide_build_breakdowns (
      guide_slug text primary key,
      featured_item_slugs text[],
      paragraphs text[]
    );
  `;

  await client`
    create table if not exists guide_variants (
      id serial primary key,
      guide_slug text not null,
      variant_key text not null,
      title text not null,
      lane text,
      tier text,
      is_default boolean not null default false,
      order_index integer not null
    );
  `;

  await client`
    create table if not exists guide_variant_sections (
      id serial primary key,
      guide_slug text not null,
      variant_key text not null,
      section_type text not null,
      section_key text not null,
      label text,
      order_index integer not null,
      entity_slugs text[]
    );
  `;

  await client`
    create table if not exists guide_variant_skill_orders (
      id serial primary key,
      guide_slug text not null,
      variant_key text not null,
      quick_order text[]
    );
  `;

  await client`
    create table if not exists guide_variant_skill_rows (
      id serial primary key,
      guide_slug text not null,
      variant_key text not null,
      ability_slug text not null,
      row_name text not null,
      order_index integer not null,
      levels integer[]
    );
  `;

  await client`
    create table if not exists guide_variant_matchups (
      id serial primary key,
      guide_slug text not null,
      variant_key text not null,
      matchup_type text not null,
      champion_slug text not null,
      order_index integer not null
    );
  `;

  await client`
    create unique index if not exists guide_entities_kind_slug_uidx
    on guide_entities (kind, slug);
  `;

  await client`
    create unique index if not exists guide_variants_slug_key_uidx
    on guide_variants (guide_slug, variant_key);
  `;

  await client`
    create index if not exists guide_variants_slug_order_idx
    on guide_variants (guide_slug, order_index);
  `;

  await client`
    create index if not exists guide_summaries_name_idx
    on guide_summaries (name);
  `;

  await client`
    create index if not exists guide_entities_slug_idx
    on guide_entities (slug);
  `;

  await client`
    create index if not exists guide_abilities_guide_order_idx
    on guide_abilities (guide_slug, order_index);
  `;

  await client`
    create index if not exists guide_sections_slug_variant_idx
    on guide_variant_sections (guide_slug, variant_key, section_type);
  `;

  await client`
    create unique index if not exists guide_skill_orders_slug_variant_uidx
    on guide_variant_skill_orders (guide_slug, variant_key);
  `;

  await client`
    create index if not exists guide_skill_rows_slug_variant_idx
    on guide_variant_skill_rows (guide_slug, variant_key);
  `;

  await client`
    create index if not exists guide_matchups_slug_variant_idx
    on guide_variant_matchups (guide_slug, variant_key, matchup_type);
  `;

  console.log("guide tables are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
