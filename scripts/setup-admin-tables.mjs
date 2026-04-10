import "dotenv/config";

import { client } from "../db/client.js";

async function main() {
  await client`
    create table if not exists admin_users (
      id serial primary key,
      display_name text,
      primary_email text,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz
    );
  `;

  await client`
    create table if not exists admin_identities (
      id serial primary key,
      user_id integer not null,
      provider text not null,
      provider_subject text not null,
      provider_email text,
      provider_username text,
      profile jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz
    );
  `;

  await client`
    create table if not exists admin_roles (
      key text primary key,
      label text not null,
      description text,
      created_at timestamptz not null default now()
    );
  `;

  await client`
    create table if not exists admin_user_roles (
      user_id integer not null,
      role_key text not null,
      created_at timestamptz not null default now(),
      primary key (user_id, role_key)
    );
  `;

  await client`
    create table if not exists admin_sessions (
      id serial primary key,
      user_id integer not null,
      session_hash text not null,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      user_agent text,
      ip_hash text
    );
  `;

  await client`
    create unique index if not exists admin_users_primary_email_uidx
    on admin_users (primary_email);
  `;

  await client`
    create index if not exists admin_users_status_idx
    on admin_users (status);
  `;

  await client`
    create unique index if not exists admin_identities_provider_subject_uidx
    on admin_identities (provider, provider_subject);
  `;

  await client`
    create index if not exists admin_identities_user_idx
    on admin_identities (user_id);
  `;

  await client`
    create index if not exists admin_identities_provider_email_idx
    on admin_identities (provider_email);
  `;

  await client`
    create index if not exists admin_user_roles_user_idx
    on admin_user_roles (user_id);
  `;

  await client`
    create index if not exists admin_user_roles_role_idx
    on admin_user_roles (role_key);
  `;

  await client`
    create unique index if not exists admin_sessions_session_hash_uidx
    on admin_sessions (session_hash);
  `;

  await client`
    create index if not exists admin_sessions_user_idx
    on admin_sessions (user_id);
  `;

  await client`
    create index if not exists admin_sessions_expires_idx
    on admin_sessions (expires_at);
  `;

  await client`
    create table if not exists site_users (
      id serial primary key,
      display_name text,
      avatar_url text,
      wild_rift_handle text,
      peak_rank text,
      main_champion_slugs text[] not null default '{}',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz
    );
  `;

  await client`
    alter table site_users
    add column if not exists wild_rift_handle text;
  `;

  await client`
    alter table site_users
    add column if not exists peak_rank text;
  `;

  await client`
    alter table site_users
    add column if not exists main_champion_slugs text[] not null default '{}';
  `;

  await client`
    create table if not exists site_identities (
      id serial primary key,
      user_id integer not null,
      provider text not null,
      provider_subject text not null,
      provider_email text,
      provider_username text,
      profile jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      last_login_at timestamptz
    );
  `;

  await client`
    create table if not exists site_sessions (
      id serial primary key,
      user_id integer not null,
      session_hash text not null,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      user_agent text,
      ip_hash text
    );
  `;

  await client`
    create index if not exists site_users_status_idx
    on site_users (status);
  `;

  await client`
    create unique index if not exists site_identities_provider_subject_uidx
    on site_identities (provider, provider_subject);
  `;

  await client`
    create index if not exists site_identities_user_idx
    on site_identities (user_id);
  `;

  await client`
    create index if not exists site_identities_provider_email_idx
    on site_identities (provider_email);
  `;

  await client`
    create unique index if not exists site_sessions_session_hash_uidx
    on site_sessions (session_hash);
  `;

  await client`
    create index if not exists site_sessions_user_idx
    on site_sessions (user_id);
  `;

  await client`
    create index if not exists site_sessions_expires_idx
    on site_sessions (expires_at);
  `;

  await client`
    insert into admin_roles (key, label, description)
    values
      ('owner', 'Owner', 'Full access, can manage roles and admin users'),
      ('admin', 'Admin', 'Operational access to admin tools'),
      ('streamer', 'Streamer', 'Access to streamer-only sections'),
      ('patron', 'Patron', 'Access to patron-only sections')
    on conflict (key) do nothing;
  `;

  console.log("auth tables are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
