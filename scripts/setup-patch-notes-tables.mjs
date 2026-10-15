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
      check (entity_kind in ('champion', 'item', 'rune', 'system', 'skin')),
      check (change_type in ('buff', 'nerf', 'rework', 'adjustment'))
    );
  `;
  await client`alter table patch_note_changes drop constraint if exists patch_note_changes_entity_kind_check;`;
  await client`
    alter table patch_note_changes
    add constraint patch_note_changes_entity_kind_check
    check (entity_kind in ('champion', 'item', 'rune', 'system', 'skin'));
  `;
  await client`alter table patch_note_changes drop constraint if exists patch_note_changes_change_type_check;`;
  await client`
    alter table patch_note_changes
    add constraint patch_note_changes_change_type_check
    check (change_type in ('new', 'buff', 'nerf', 'rework', 'adjustment', 'removed'));
  `;
  await client`create index if not exists patch_note_changes_patch_locale_idx on patch_note_changes (patch_version, locale);`;
  await client`create index if not exists patch_note_changes_direction_idx on patch_note_changes (patch_version, locale, change_type);`;
  console.log("patch notes table is ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => client.end({ timeout: 5 }));
