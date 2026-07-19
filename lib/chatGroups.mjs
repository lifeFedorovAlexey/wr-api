import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  chatChannels,
  chatGroupBans,
  chatGroupMembers,
  chatGroups,
  chatMessages,
  chatModerationActions,
  siteUsers,
} from "../db/schema.js";
import {
  attachChatAttachments,
  CHAT_CONTENT_RETENTION_DAYS,
  listChatAttachmentsForMessages,
  markChatAttachmentsDeleted,
  validatePendingChatAttachments,
} from "./chatAttachments.mjs";
import { assertChatUserNotMuted, registerChatMessageAttempt } from "./chatAntiSpam.mjs";
import { isGlobalChatAdmin, normalizeChatActor } from "./chatPermissions.mjs";

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

function normalizeDeletionReason(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 300);
}

function getVisibleChatHistoryCutoff(now = new Date()) {
  return new Date(now.getTime() - CHAT_CONTENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
}

function mapChatMessageRow(row, attachments = []) {
  return {
    id: row.id,
    channelId: row.channelId,
    authorUserId: row.authorUserId,
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    author: {
      id: row.authorUserId,
      displayName: row.authorDisplayName || "",
      avatarUrl: row.authorAvatarUrl || "",
    },
    attachments,
  };
}

async function ensureUserCanAccessGroup(groupId, actorInput) {
  const actor = normalizeChatActor(actorInput);
  if (!actor.id) return null;
  if (isGlobalChatAdmin(actor)) {
    return { groupId: Number(groupId), role: "admin" };
  }

  const [membership] = await db
    .select({
      groupId: chatGroupMembers.groupId,
      role: chatGroupMembers.role,
    })
    .from(chatGroupMembers)
    .where(
      and(eq(chatGroupMembers.groupId, groupId), eq(chatGroupMembers.userId, actor.id)),
    )
    .limit(1);

  if (!membership) {
    return null;
  }

  const [ban] = await db
    .select({ groupId: chatGroupBans.groupId })
    .from(chatGroupBans)
    .where(and(eq(chatGroupBans.groupId, groupId), eq(chatGroupBans.userId, actor.id)))
    .limit(1);

  if (ban) {
    return null;
  }

  return membership;
}

async function ensureUserCanAccessChannel(channelId, actorInput) {
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

  const membership = await ensureUserCanAccessGroup(channel.groupId, actorInput);
  if (!membership) {
    return null;
  }

  return { channel, membership };
}

export async function getChatChannelAccessForUser(actorInput, channelId) {
  const actor = normalizeChatActor(actorInput);
  const normalizedChannelId = Number(channelId || 0);

  if (!actor.id || !normalizedChannelId) {
    throw new Error("chat_channel_forbidden");
  }

  const access = await ensureUserCanAccessChannel(normalizedChannelId, actor);
  if (!access) {
    throw new Error("chat_channel_forbidden");
  }

  return access;
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

export async function createChatGroup(ownerInput, input = {}) {
  const ownerUserId = normalizeChatActor(ownerInput).id;
  const name = normalizeGroupName(input.name);
  const description = normalizeDescription(input.description);
  const isPrivate = input.isPrivate !== false;

  if (!ownerUserId || !name) {
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

export async function listChatGroupsForUser(actorInput) {
  const actor = normalizeChatActor(actorInput);
  if (!actor.id) throw new Error("chat_group_forbidden");
  await ensureDefaultChatGroupForUser(actor.id);

  if (isGlobalChatAdmin(actor)) {
    return await db
      .select({
        id: chatGroups.id,
        slug: chatGroups.slug,
        name: chatGroups.name,
        description: chatGroups.description,
        isPrivate: chatGroups.isPrivate,
        ownerUserId: chatGroups.ownerUserId,
        createdAt: chatGroups.createdAt,
        updatedAt: chatGroups.updatedAt,
        membershipRole: sql`'admin'`,
      })
      .from(chatGroups)
      .orderBy(desc(chatGroups.updatedAt), asc(chatGroups.id));
  }

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
    .where(eq(chatGroupMembers.userId, actor.id))
    .orderBy(desc(chatGroups.updatedAt), asc(chatGroups.id));

  if (!rows.length) {
    return [];
  }

  const bans = await db
    .select({ groupId: chatGroupBans.groupId })
    .from(chatGroupBans)
    .where(
      and(
        eq(chatGroupBans.userId, actor.id),
        inArray(
          chatGroupBans.groupId,
          rows.map((row) => row.id),
        ),
      ),
    );

  const bannedGroupIds = new Set(bans.map((row) => row.groupId));
  return rows.filter((row) => !bannedGroupIds.has(row.id));
}

export async function listChatChannelsForUser(actorInput, groupId) {
  const membership = await ensureUserCanAccessGroup(groupId, actorInput);
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

export async function listChatMessagesForUser(actorInput, channelId, { limit = 50 } = {}) {
  const access = await ensureUserCanAccessChannel(channelId, actorInput);
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
      authorDisplayName: siteUsers.displayName,
      authorAvatarUrl: siteUsers.avatarUrl,
    })
    .from(chatMessages)
    .leftJoin(siteUsers, eq(siteUsers.id, chatMessages.authorUserId))
    .where(
      and(
        eq(chatMessages.channelId, channelId),
        isNull(chatMessages.deletedAt),
        gt(chatMessages.createdAt, getVisibleChatHistoryCutoff()),
      ),
    )
    .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
    .limit(normalizedLimit);

  const sortedRows = rows.reverse();
  const attachments = await listChatAttachmentsForMessages(sortedRows.map((row) => row.id));
  return sortedRows.map((row) => mapChatMessageRow(row, attachments.get(row.id) || []));
}

async function getChatMessageAuthor(userId) {
  const [author] = await db
    .select({
      id: siteUsers.id,
      displayName: siteUsers.displayName,
      avatarUrl: siteUsers.avatarUrl,
    })
    .from(siteUsers)
    .where(eq(siteUsers.id, Number(userId)))
    .limit(1);

  return {
    id: Number(userId),
    displayName: author?.displayName || "",
    avatarUrl: author?.avatarUrl || "",
  };
}

export async function createChatMessage(actorInput, input = {}, env = process.env) {
  const actor = normalizeChatActor(actorInput);
  const userId = actor.id;
  const channelId = Number(input.channelId || 0);
  const body = normalizeMessageBody(input.body);
  const attachmentIds = Array.isArray(input.attachmentIds) ? input.attachmentIds : [];

  if (!userId || !channelId) {
    throw new Error("chat_channel_required");
  }

  if (!body && !attachmentIds.length) {
    throw new Error("chat_message_body_required");
  }

  const access = await ensureUserCanAccessChannel(channelId, actor);
  if (!access) {
    throw new Error("chat_channel_forbidden");
  }

  await assertChatUserNotMuted(access.channel.groupId, userId);
  await registerChatMessageAttempt(access.channel.groupId, userId);

  const attachmentRows = await validatePendingChatAttachments(
    userId,
    channelId,
    attachmentIds,
    env,
  );

  let message;
  if (attachmentRows.length) {
    message = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(chatMessages)
        .values({ channelId, authorUserId: userId, body })
        .returning();
      await attachChatAttachments(tx, created.id, attachmentRows);
      return created;
    });
  } else {
    [message] = await db
      .insert(chatMessages)
      .values({
        channelId,
        authorUserId: userId,
        body,
      })
      .returning();
  }

  await db
    .update(chatGroups)
    .set({ updatedAt: new Date() })
    .where(eq(chatGroups.id, access.channel.groupId));

  const author = await getChatMessageAuthor(userId);
  const attachments = attachmentRows.map((attachment) => ({
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    mediaKind: attachment.mediaKind,
    sizeBytes: attachment.sizeBytes,
    url: null,
    expiresAt: attachment.expiresAt,
  }));

  if (attachments.length) {
    const signed = await listChatAttachmentsForMessages([message.id], env);
    return { ...message, author, attachments: signed.get(message.id) || attachments };
  }

  return { ...message, author, attachments: [] };
}

export async function deleteChatMessage(actorInput, input = {}) {
  const actor = normalizeChatActor(actorInput);
  const messageId = Number(input.messageId || 0);
  const reason = normalizeDeletionReason(input.reason);
  if (!actor.id || !messageId) {
    throw new Error("chat_message_delete_invalid");
  }

  const [message] = await db
    .select({
      id: chatMessages.id,
      channelId: chatMessages.channelId,
      authorUserId: chatMessages.authorUserId,
      deletedAt: chatMessages.deletedAt,
      groupId: chatChannels.groupId,
    })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(eq(chatMessages.id, messageId))
    .limit(1);

  if (!message) {
    throw new Error("chat_message_not_found");
  }

  const ownsMessage = Number(message.authorUserId) === actor.id;
  if (!ownsMessage && !isGlobalChatAdmin(actor)) {
    throw new Error("chat_message_delete_forbidden");
  }

  if (ownsMessage && !isGlobalChatAdmin(actor)) {
    const access = await ensureUserCanAccessChannel(message.channelId, actor.id);
    if (!access) {
      throw new Error("chat_message_delete_forbidden");
    }
  }

  if (message.deletedAt) {
    return {
      messageId: message.id,
      channelId: message.channelId,
      groupId: message.groupId,
      deletedAt: message.deletedAt,
    };
  }

  const deletedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(chatMessages)
      .set({
        deletedAt,
        deletedByUserId: actor.id,
        deletionReason: reason || null,
      })
      .where(and(eq(chatMessages.id, message.id), isNull(chatMessages.deletedAt)));

    await markChatAttachmentsDeleted(tx, message.id, deletedAt);
    await tx.insert(chatModerationActions).values({
      action: ownsMessage ? "message_delete_self" : "message_delete_admin",
      actorUserId: actor.id,
      targetUserId: message.authorUserId,
      groupId: message.groupId,
      channelId: message.channelId,
      messageId: message.id,
      reason: reason || null,
      metadata: null,
    });
  });

  return {
    messageId: message.id,
    channelId: message.channelId,
    groupId: message.groupId,
    deletedAt,
  };
}
