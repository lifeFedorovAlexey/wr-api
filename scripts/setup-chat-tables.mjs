import "dotenv/config";

import { client } from "../db/client.js";

async function setupChatGroups() {
  await client`
    create table if not exists chat_groups (
      id serial primary key,
      owner_user_id integer not null,
      slug text not null,
      name text not null,
      description text,
      is_private boolean not null default true,
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

  await client`alter table chat_groups drop column if exists access;`;
  await client`alter table chat_groups drop column if exists status;`;
  await client`alter table chat_groups add column if not exists is_private boolean not null default true;`;
}

async function setupChatMembership() {
  await client`
    create table if not exists chat_group_members (
      group_id integer not null,
      user_id integer not null,
      role text not null default 'member',
      joined_at timestamptz not null default now(),
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

  await client`alter table chat_group_members drop column if exists status;`;
  await client`alter table chat_group_members drop column if exists invited_by_user_id;`;
  await client`alter table chat_group_members drop column if exists updated_at;`;

  await client`
    create table if not exists chat_group_invites (
      id serial primary key,
      group_id integer not null,
      inviter_user_id integer not null,
      invitee_user_id integer not null,
      status text not null default 'pending',
      created_at timestamptz not null default now(),
      responded_at timestamptz
    );
  `;

  await client`drop index if exists chat_group_invites_token_uidx;`;
  await client`drop index if exists chat_group_invites_group_idx;`;
  await client`drop index if exists chat_group_invites_invitee_idx;`;
  await client`alter table chat_group_invites drop column if exists token;`;
  await client`alter table chat_group_invites drop column if exists expires_at;`;
  await client`alter table chat_group_invites drop column if exists accepted_at;`;
  await client`alter table chat_group_invites drop column if exists revoked_at;`;
  await client`alter table chat_group_invites alter column invitee_user_id set not null;`;
  await client`alter table chat_group_invites add column if not exists responded_at timestamptz;`;

  await client`
    create index if not exists chat_group_invites_status_idx
    on chat_group_invites (status);
  `;

  await client`
    create index if not exists chat_group_invites_group_invitee_idx
    on chat_group_invites (group_id, invitee_user_id);
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
      slug text not null,
      name text not null,
      kind text not null default 'text',
      position integer not null default 0,
      created_at timestamptz not null default now()
    );
  `;

  await client`drop index if exists chat_channels_group_key_uidx;`;
  await client`drop index if exists chat_channels_status_idx;`;
  await client`alter table chat_channels drop column if exists status;`;
  await client`alter table chat_channels drop column if exists updated_at;`;

  await client`
    do $$
    begin
      if exists (
        select 1
        from information_schema.columns
        where table_name = 'chat_channels' and column_name = 'key'
      ) and not exists (
        select 1
        from information_schema.columns
        where table_name = 'chat_channels' and column_name = 'slug'
      ) then
        alter table chat_channels rename column key to slug;
      end if;
    end $$;
  `;

  await client`
    create unique index if not exists chat_channels_group_slug_uidx
    on chat_channels (group_id, slug);
  `;

  await client`
    create index if not exists chat_channels_group_position_idx
    on chat_channels (group_id, position);
  `;
}

async function setupChatMessages() {
  await client`
    create table if not exists chat_messages (
      id serial primary key,
      channel_id integer not null,
      author_user_id integer not null,
      body text not null,
      edited_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz not null default now()
    );
  `;

  await client`alter table chat_messages drop column if exists group_id;`;
  await client`alter table chat_messages drop column if exists metadata;`;
  await client`alter table chat_messages drop column if exists updated_at;`;

  await client`
    create index if not exists chat_messages_channel_created_idx
    on chat_messages (channel_id, created_at);
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
