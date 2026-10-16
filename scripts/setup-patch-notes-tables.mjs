import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists patch_notes (
      patch_version text not null,
      locale text not null,
      title text not null,
      description text,
      source_url text not null,
      published_at timestamptz,
      effective_date date,
      effective_region text,
      effective_date_source_url text,
      image_url text,
      raw_html text not null,
      content_hash text not null,
      parser_version integer not null default 1,
      parse_status text not null default 'pending',
      parse_error text,
      parsed_payload jsonb,
      imported_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (patch_version, locale),
      check (locale in ('en-us', 'ru-ru')),
      check (parse_status in ('pending', 'parsed', 'failed'))
    );
  `;
  await client`alter table patch_notes add column if not exists effective_date date;`;
  await client`alter table patch_notes add column if not exists effective_region text;`;
  await client`alter table patch_notes add column if not exists effective_date_source_url text;`;
  await client`create index if not exists patch_notes_published_at_idx on patch_notes (published_at desc);`;
  await client`create index if not exists patch_notes_status_idx on patch_notes (parse_status, parser_version);`;
  await client`
    create table if not exists patch_note_changes (
      id serial primary key,
      patch_version text not null,
      locale text not null,
      ordinal integer not null,
      entity_kind text not null,
      entity_slug text,
      entity_name text not null,
      image_url text,
      change_type text not null,
      section_name text,
      change_name text,
      details jsonb not null default '[]'::jsonb,
      updated_at timestamptz not null default now(),
      unique (patch_version, locale, ordinal),
      check (locale in ('en-us', 'ru-ru')),
      check (entity_kind in ('champion', 'item', 'rune', 'spell', 'system', 'skin')),
      check (change_type in ('buff', 'nerf', 'rework', 'adjustment'))
    );
  `;
  await client`alter table patch_note_changes drop constraint if exists patch_note_changes_entity_kind_check;`;
  await client`
    alter table patch_note_changes
    add constraint patch_note_changes_entity_kind_check
    check (entity_kind in ('champion', 'item', 'rune', 'spell', 'system', 'skin'));
  `;
  await client`alter table patch_note_changes drop constraint if exists patch_note_changes_change_type_check;`;
  await client`
    alter table patch_note_changes
    add constraint patch_note_changes_change_type_check
    check (change_type in ('new', 'buff', 'nerf', 'rework', 'adjustment', 'removed'));
  `;
  await client`create index if not exists patch_note_changes_patch_locale_idx on patch_note_changes (patch_version, locale);`;
  await client`create index if not exists patch_note_changes_direction_idx on patch_note_changes (patch_version, locale, change_type);`;
  await client`
    create table if not exists patch_data_snapshots (
      patch_version text not null,
      dataset text not null,
      entity_kind text not null,
      entity_slug text not null,
      state jsonb not null,
      source_kind text not null,
      source_url text not null,
      source_patch_version text,
      source_updated_at date,
      verification_status text not null default 'verified',
      source_evidence jsonb not null default '[]'::jsonb,
      content_hash text not null,
      updated_at timestamptz not null default now(),
      primary key (patch_version, dataset, entity_slug),
      check (dataset in ('champion-base-stats', 'champion-abilities', 'items', 'runes', 'summoner-spells')),
      check (verification_status in ('verified', 'derived', 'partial', 'unresolved'))
    );
  `;
  await client`create index if not exists patch_data_snapshots_entity_version_idx on patch_data_snapshots (entity_kind, entity_slug, patch_version);`;
  await client`create index if not exists patch_data_snapshots_dataset_status_idx on patch_data_snapshots (dataset, verification_status, patch_version);`;
  await client`
    create table if not exists patch_data_transitions (
      id serial primary key,
      patch_version text not null,
      locale text not null,
      mode text not null,
      dataset text not null,
      entity_kind text not null,
      entity_slug text not null,
      property_path text not null,
      value_type text not null,
      before_value jsonb not null,
      after_value jsonb not null,
      change_type text not null,
      source_kind text not null,
      source_url text not null,
      source_evidence jsonb not null default '[]'::jsonb,
      verification_status text not null default 'unresolved',
      review_note text,
      updated_at timestamptz not null default now(),
      check (locale in ('en-us', 'ru-ru')),
      check (value_type in ('number', 'string', 'boolean', 'null', 'object', 'array')),
      check (jsonb_typeof(before_value) = value_type and jsonb_typeof(after_value) = value_type),
      check (change_type in ('new', 'buff', 'nerf', 'rework', 'adjustment', 'removed')),
      check (verification_status in ('verified', 'unresolved'))
    );
  `;
  await client`create unique index if not exists patch_data_transitions_identity_uidx on patch_data_transitions (patch_version, locale, mode, dataset, entity_slug, property_path);`;
  await client`create index if not exists patch_data_transitions_chain_idx on patch_data_transitions (dataset, mode, entity_kind, entity_slug, patch_version);`;
  await client`create index if not exists patch_data_transitions_status_idx on patch_data_transitions (verification_status, patch_version);`;
  await client`
    create table if not exists patch_data_discrepancies (
      id serial primary key,
      patch_version text,
      entity_kind text not null,
      entity_slug text,
      property_path text not null,
      primary_source_kind text not null,
      primary_value jsonb not null,
      comparison_source_kind text not null,
      comparison_value jsonb not null,
      selected_source_kind text,
      resolution_status text not null default 'unresolved',
      note text,
      source_urls jsonb not null default '[]'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (resolution_status in ('unresolved', 'resolved'))
    );
  `;
  await client`create index if not exists patch_data_discrepancies_patch_entity_idx on patch_data_discrepancies (patch_version, entity_kind, entity_slug);`;
  await client`create index if not exists patch_data_discrepancies_status_idx on patch_data_discrepancies (resolution_status);`;
  console.log("patch notes table is ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
