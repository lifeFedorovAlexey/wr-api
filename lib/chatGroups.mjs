import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  chatChannels,
  chatGroupBans,
  chatGroupMembers,
  chatGroups,
  chatMessages,
} from "../db/schema.js";

const DEFAULT_CHAT_GROUP_SLUG = "general";
const DEFAULT_CHAT_GROUP_NAME = "General";
const DEFAULT_CHAT_GROUP_DESCRIPTION = "Общий чат по умолчанию";

function normalizeGroupName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeDescription(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 300);
}

function slugifyGroupName(value) {
  const base = normalizeGroupName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return base || "group";
}

export function buildChatGroupSlug(value) {
  return slugifyGroupName(value);
}

function normalizeMessageBody(value) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, 4000);
}

async function ensureUserCanAccessGroup(groupId, userId) {
  const [membership] = await db
    .select({
      groupId: chatGroupMembers.groupId,
      role: chatGroupMembers.role,
    })
    .from(chatGroupMembers)
    .where(
      and(eq(chatGroupMembers.groupId, groupId), eq(chatGroupMembers.userId, userId)),
    )
    .limit(1);

  if (!membership) {
    return null;
  }

  const [ban] = await db
    .select({ groupId: chatGroupBans.groupId })
    .from(chatGroupBans)
    .where(and(eq(chatGroupBans.groupId, groupId), eq(chatGroupBans.userId, userId)))
    .limit(1);

  if (ban) {
    return null;
  }

  return membership;
}

async function ensureUserCanAccessChannel(channelId, userId) {
  const [channel] = await db
    .select({
      id: chatChannels.id,
      groupId: chatChannels.groupId,
      slug: chatChannels.slug,
      name: chatChannels.name,
      kind: chatChannels.kind,
      position: chatChannels.position,
      createdAt: chatChannels.createdAt,
    })
    .from(chatChannels)
    .where(eq(chatChannels.id, channelId))
    .limit(1);

  if (!channel) {
    return null;
  }

  const membership = await ensureUserCanAccessGroup(channel.groupId, userId);
  if (!membership) {
    return null;
  }

  return { channel, membership };
}

async function ensureDefaultChatGroupForUser(userId) {
  const [existingGroup] = await db
    .select({
      id: chatGroups.id,
      ownerUserId: chatGroups.ownerUserId,
      slug: chatGroups.slug,
      name: chatGroups.name,
      description: chatGroups.description,
      isPrivate: chatGroups.isPrivate,
      createdAt: chatGroups.createdAt,
      updatedAt: chatGroups.updatedAt,
    })
    .from(chatGroups)
    .where(eq(chatGroups.slug, DEFAULT_CHAT_GROUP_SLUG))
    .limit(1);

  let group = existingGroup;

  if (!group) {
    [group] = await db
      .insert(chatGroups)
      .values({
        ownerUserId: userId,
        slug: DEFAULT_CHAT_GROUP_SLUG,
        name: DEFAULT_CHAT_GROUP_NAME,
        description: DEFAULT_CHAT_GROUP_DESCRIPTION,
        isPrivate: false,
      })
      .returning();
  }

  const [channel] = await db
    .select({
      id: chatChannels.id,
      groupId: chatChannels.groupId,
      slug: chatChannels.slug,
    })
    .from(chatChannels)
    .where(
      and(
        eq(chatChannels.groupId, group.id),
        eq(chatChannels.slug, DEFAULT_CHAT_GROUP_SLUG),
      ),
    )
    .limit(1);

  if (!channel) {
    await db
      .insert(chatChannels)
      .values({
        groupId: group.id,
        slug: DEFAULT_CHAT_GROUP_SLUG,
        name: DEFAULT_CHAT_GROUP_SLUG,
        kind: "text",
        position: 0,
      })
      .returning();
  }

  const [ban] = await db
    .select({ groupId: chatGroupBans.groupId })
    .from(chatGroupBans)
    .where(and(eq(chatGroupBans.groupId, group.id), eq(chatGroupBans.userId, userId)))
    .limit(1);

  if (ban) {
    return group;
  }

  const [membership] = await db
    .select({ groupId: chatGroupMembers.groupId })
    .from(chatGroupMembers)
    .where(
      and(
        eq(chatGroupMembers.groupId, group.id),
        eq(chatGroupMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    await db.insert(chatGroupMembers).values({
      groupId: group.id,
      userId,
      role: "member",
    });
  }

  return group;
}

export async function createChatGroup(ownerUserId, input = {}) {
  const name = normalizeGroupName(input.name);
  const description = normalizeDescription(input.description);
  const isPrivate = input.isPrivate !== false;

  if (!name) {
    throw new Error("chat_group_name_required");
  }

  const baseSlug = slugifyGroupName(name);
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(chatGroups)
    .where(sql`${chatGroups.slug} like ${`${baseSlug}%`}`);

  const suffix = Number(count || 0);
  const slug = suffix > 0 ? `${baseSlug}-${suffix + 1}` : baseSlug;

  const [group] = await db
    .insert(chatGroups)
    .values({
      ownerUserId,
      slug,
      name,
      description: description || null,
      isPrivate,
    })
    .returning();

  await db.insert(chatGroupMembers).values({
    groupId: group.id,
    userId: ownerUserId,
    role: "owner",
  });

  const [channel] = await db
    .insert(chatChannels)
    .values({
      groupId: group.id,
      slug: "general",
      name: "general",
      kind: "text",
      position: 0,
    })
    .returning();

  return {
    group,
    channel,
  };
}

export async function listChatGroupsForUser(userId) {
  await ensureDefaultChatGroupForUser(userId);

  const rows = await db
    .select({
      id: chatGroups.id,
      slug: chatGroups.slug,
      name: chatGroups.name,
      description: chatGroups.description,
      isPrivate: chatGroups.isPrivate,
      ownerUserId: chatGroups.ownerUserId,
      createdAt: chatGroups.createdAt,
      updatedAt: chatGroups.updatedAt,
      membershipRole: chatGroupMembers.role,
    })
    .from(chatGroupMembers)
    .innerJoin(chatGroups, eq(chatGroups.id, chatGroupMembers.groupId))
    .where(eq(chatGroupMembers.userId, userId))
    .orderBy(desc(chatGroups.updatedAt), asc(chatGroups.id));

  if (!rows.length) {
    return [];
  }

  const bans = await db
    .select({ groupId: chatGroupBans.groupId })
    .from(chatGroupBans)
    .where(
      and(
        eq(chatGroupBans.userId, userId),
        inArray(
          chatGroupBans.groupId,
          rows.map((row) => row.id),
        ),
      ),
    );

  const bannedGroupIds = new Set(bans.map((row) => row.groupId));
  return rows.filter((row) => !bannedGroupIds.has(row.id));
}

export async function listChatChannelsForUser(userId, groupId) {
  const membership = await ensureUserCanAccessGroup(groupId, userId);
  if (!membership) {
    throw new Error("chat_group_forbidden");
  }

  return await db
    .select({
      id: chatChannels.id,
      groupId: chatChannels.groupId,
      slug: chatChannels.slug,
      name: chatChannels.name,
      kind: chatChannels.kind,
      position: chatChannels.position,
      createdAt: chatChannels.createdAt,
    })
    .from(chatChannels)
    .where(eq(chatChannels.groupId, groupId))
    .orderBy(asc(chatChannels.position), asc(chatChannels.id));
}

export async function listChatMessagesForUser(userId, channelId, { limit = 50 } = {}) {
  const access = await ensureUserCanAccessChannel(channelId, userId);
  if (!access) {
    throw new Error("chat_channel_forbidden");
  }

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const rows = await db
    .select({
      id: chatMessages.id,
      channelId: chatMessages.channelId,
      authorUserId: chatMessages.authorUserId,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      editedAt: chatMessages.editedAt,
      deletedAt: chatMessages.deletedAt,
    })
    .from(chatMessages)
    .where(
      and(eq(chatMessages.channelId, channelId), isNull(chatMessages.deletedAt)),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(normalizedLimit);

  return rows.reverse();
}

export async function createChatMessage(userId, input = {}) {
  const channelId = Number(input.channelId || 0);
  const body = normalizeMessageBody(input.body);

  if (!channelId) {
    throw new Error("chat_channel_required");
  }

  if (!body) {
    throw new Error("chat_message_body_required");
  }

  const access = await ensureUserCanAccessChannel(channelId, userId);
  if (!access) {
    throw new Error("chat_channel_forbidden");
  }

  const [message] = await db
    .insert(chatMessages)
    .values({
      channelId,
      authorUserId: userId,
      body,
    })
    .returning();

  await db
    .update(chatGroups)
    .set({ updatedAt: new Date() })
    .where(eq(chatGroups.id, access.channel.groupId));

  return message;
}
