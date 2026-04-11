import "dotenv/config";

import { client } from "../db/client.js";

async function setupChatGroups() {
  await client`
    create table if not exists chat_groups (
      id serial primary key,
      owner_user_id integer not null,
      name text not null,
      slug text,
      description text,
      access text not null default 'private',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create unique index if not exists chat_groups_slug_uidx
    on chat_groups (slug);
  `;

  await client`
    create index if not exists chat_groups_owner_idx
    on chat_groups (owner_user_id);
  `;

  await client`
    create index if not exists chat_groups_status_idx
    on chat_groups (status);
  `;
}

async function setupChatMembership() {
  await client`
    create table if not exists chat_group_members (
      group_id integer not null,
      user_id integer not null,
      role text not null default 'member',
      status text not null default 'active',
      invited_by_user_id integer,
      joined_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (group_id, user_id)
    );
  `;

  await client`
    create index if not exists chat_group_members_user_idx
    on chat_group_members (user_id);
  `;

  await client`
    create index if not exists chat_group_members_role_idx
    on chat_group_members (role);
  `;

  await client`
    create index if not exists chat_group_members_status_idx
    on chat_group_members (status);
  `;

  await client`
    create table if not exists chat_group_invites (
      id serial primary key,
      group_id integer not null,
      inviter_user_id integer not null,
      invitee_user_id integer,
      token text not null,
      status text not null default 'pending',
      expires_at timestamptz,
      accepted_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    );
  `;

  await client`
    create unique index if not exists chat_group_invites_token_uidx
    on chat_group_invites (token);
  `;

  await client`
    create index if not exists chat_group_invites_group_idx
    on chat_group_invites (group_id);
  `;

  await client`
    create index if not exists chat_group_invites_invitee_idx
    on chat_group_invites (invitee_user_id);
  `;

  await client`
    create index if not exists chat_group_invites_status_idx
    on chat_group_invites (status);
  `;

  await client`
    create table if not exists chat_group_bans (
      group_id integer not null,
      user_id integer not null,
      banned_by_user_id integer not null,
      reason text,
      created_at timestamptz not null default now(),
      primary key (group_id, user_id)
    );
  `;

  await client`
    create index if not exists chat_group_bans_user_idx
    on chat_group_bans (user_id);
  `;

  await client`
    create index if not exists chat_group_bans_banned_by_idx
    on chat_group_bans (banned_by_user_id);
  `;
}

async function setupChatChannels() {
  await client`
    create table if not exists chat_channels (
      id serial primary key,
      group_id integer not null,
      key text not null,
      name text not null,
      kind text not null default 'text',
      position integer not null default 0,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create unique index if not exists chat_channels_group_key_uidx
    on chat_channels (group_id, key);
  `;

  await client`
    create index if not exists chat_channels_group_position_idx
    on chat_channels (group_id, position);
  `;

  await client`
    create index if not exists chat_channels_status_idx
    on chat_channels (status);
  `;
}

async function setupChatMessages() {
  await client`
    create table if not exists chat_messages (
      id serial primary key,
      group_id integer not null,
      channel_id integer not null,
      author_user_id integer not null,
      body text not null,
      metadata jsonb,
      edited_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `;

  await client`
    create index if not exists chat_messages_channel_created_idx
    on chat_messages (channel_id, created_at);
  `;

  await client`
    create index if not exists chat_messages_group_created_idx
    on chat_messages (group_id, created_at);
  `;

  await client`
    create index if not exists chat_messages_author_idx
    on chat_messages (author_user_id);
  `;

  await client`
    create table if not exists chat_channel_reads (
      channel_id integer not null,
      user_id integer not null,
      last_read_message_id integer,
      last_read_at timestamptz,
      updated_at timestamptz not null default now(),
      primary key (channel_id, user_id)
    );
  `;

  await client`
    create index if not exists chat_channel_reads_user_idx
    on chat_channel_reads (user_id);
  `;
}

async function main() {
  await setupChatGroups();
  await setupChatMembership();
  await setupChatChannels();
  await setupChatMessages();

  console.log("chat tables are ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end({ timeout: 5 });
  });
