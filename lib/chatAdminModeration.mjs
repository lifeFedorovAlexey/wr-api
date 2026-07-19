import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  chatChannels,
  chatGroupBans,
  chatGroupMembers,
  chatGroups,
  chatModerationActions,
  chatMutes,
  siteUsers,
} from "../db/schema.js";
import { formatChatMute } from "./chatAntiSpam.mjs";
import { requireGlobalChatAdmin } from "./chatPermissions.mjs";

const SUPPORTED_ACTIONS = new Set(["ban", "unban", "kick", "mute", "unmute"]);

function normalizeReason(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 300);
}

async function requireGroup(groupId) {
  const [group] = await db.select().from(chatGroups).where(eq(chatGroups.id, groupId)).limit(1);
  if (!group) throw new Error("chat_group_not_found");
  return group;
}

async function listGroupChannelIds(groupId) {
  const channels = await db
    .select({ id: chatChannels.id })
    .from(chatChannels)
    .where(eq(chatChannels.groupId, groupId));
  return channels.map((channel) => Number(channel.id));
}

async function applyManualMute(tx, { actor, groupId, targetUserId, reason, input }) {
  const durationSeconds = Number(input.durationSeconds || 0);
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error("chat_mute_duration_required");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationSeconds * 1_000);
  await tx
    .update(chatMutes)
    .set({ revokedAt: now })
    .where(
      and(
        eq(chatMutes.groupId, groupId),
        eq(chatMutes.userId, targetUserId),
        isNull(chatMutes.revokedAt),
      ),
    );

  const [mute] = await tx
    .insert(chatMutes)
    .values({
      groupId,
      userId: targetUserId,
      mutedByUserId: actor.id,
      source: "manual",
      reason: reason || null,
      startsAt: now,
      expiresAt,
    })
    .returning();
  await tx.insert(chatModerationActions).values({
    action: "mute",
    actorUserId: actor.id,
    targetUserId,
    groupId,
    reason: reason || null,
    durationSeconds,
  });
  return { mute: formatChatMute(mute) };
}

export async function listChatModerationState(actorInput, groupIdInput) {
  requireGlobalChatAdmin(actorInput);
  const groupId = Number(groupIdInput || 0);
  if (!groupId) throw new Error("chat_group_required");
  await requireGroup(groupId);

  const [members, bans, mutes, recentActions] = await Promise.all([
    db
      .select({
        userId: chatGroupMembers.userId,
        membershipRole: chatGroupMembers.role,
        joinedAt: chatGroupMembers.joinedAt,
        displayName: siteUsers.displayName,
        avatarUrl: siteUsers.avatarUrl,
      })
      .from(chatGroupMembers)
      .leftJoin(siteUsers, eq(siteUsers.id, chatGroupMembers.userId))
      .where(eq(chatGroupMembers.groupId, groupId)),
    db
      .select({
        groupId: chatGroupBans.groupId,
        userId: chatGroupBans.userId,
        bannedByUserId: chatGroupBans.bannedByUserId,
        reason: chatGroupBans.reason,
        createdAt: chatGroupBans.createdAt,
        displayName: siteUsers.displayName,
        avatarUrl: siteUsers.avatarUrl,
      })
      .from(chatGroupBans)
      .leftJoin(siteUsers, eq(siteUsers.id, chatGroupBans.userId))
      .where(eq(chatGroupBans.groupId, groupId)),
    db
      .select()
      .from(chatMutes)
      .where(
        and(
          eq(chatMutes.groupId, groupId),
          isNull(chatMutes.revokedAt),
          gt(chatMutes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(chatMutes.expiresAt)),
    db
      .select({
        id: chatModerationActions.id,
        action: chatModerationActions.action,
        actorUserId: chatModerationActions.actorUserId,
        targetUserId: chatModerationActions.targetUserId,
        groupId: chatModerationActions.groupId,
        channelId: chatModerationActions.channelId,
        messageId: chatModerationActions.messageId,
        reason: chatModerationActions.reason,
        durationSeconds: chatModerationActions.durationSeconds,
        createdAt: chatModerationActions.createdAt,
      })
      .from(chatModerationActions)
      .where(eq(chatModerationActions.groupId, groupId))
      .orderBy(desc(chatModerationActions.createdAt), desc(chatModerationActions.id))
      .limit(50),
  ]);

  return {
    members: members.map((member) => ({
      user: {
        id: member.userId,
        displayName: member.displayName || "",
        avatarUrl: member.avatarUrl || "",
      },
      membershipRole: member.membershipRole,
      joinedAt: member.joinedAt,
    })),
    bans: bans.map((ban) => ({
      ...ban,
      user: {
        id: ban.userId,
        displayName: ban.displayName || "",
        avatarUrl: ban.avatarUrl || "",
      },
      displayName: undefined,
      avatarUrl: undefined,
    })),
    mutes: mutes.map(formatChatMute),
    recentActions,
  };
}

export async function applyChatModerationAction(actorInput, input = {}) {
  const actor = requireGlobalChatAdmin(actorInput);
  const groupId = Number(input.groupId || 0);
  const targetUserId = Number(input.targetUserId || 0);
  const action = String(input.action || "").trim().toLowerCase();
  const reason = normalizeReason(input.reason);

  if (
    !groupId ||
    !targetUserId ||
    actor.id === targetUserId ||
    !SUPPORTED_ACTIONS.has(action)
  ) {
    throw new Error("chat_moderation_invalid");
  }

  const group = await requireGroup(groupId);
  const affectedChannelIds = await listGroupChannelIds(groupId);
  let result = null;

  await db.transaction(async (tx) => {
    if (action === "mute") {
      result = await applyManualMute(tx, {
        actor,
        groupId,
        targetUserId,
        reason,
        input,
      });
      return;
    }

    if (action === "unmute") {
      const revokedAt = new Date();
      await tx
        .update(chatMutes)
        .set({ revokedAt })
        .where(
          and(
            eq(chatMutes.groupId, groupId),
            eq(chatMutes.userId, targetUserId),
            isNull(chatMutes.revokedAt),
          ),
        );
      result = { unmutedAt: revokedAt };
    } else if (action === "ban") {
      const [ban] = await tx
        .insert(chatGroupBans)
        .values({
          groupId,
          userId: targetUserId,
          bannedByUserId: actor.id,
          reason: reason || null,
        })
        .onConflictDoUpdate({
          target: [chatGroupBans.groupId, chatGroupBans.userId],
          set: {
            bannedByUserId: actor.id,
            reason: reason || null,
            createdAt: new Date(),
          },
        })
        .returning();
      await tx
        .delete(chatGroupMembers)
        .where(
          and(
            eq(chatGroupMembers.groupId, groupId),
            eq(chatGroupMembers.userId, targetUserId),
          ),
        );
      result = { ban };
    } else if (action === "unban") {
      await tx
        .delete(chatGroupBans)
        .where(
          and(eq(chatGroupBans.groupId, groupId), eq(chatGroupBans.userId, targetUserId)),
        );

      if (!group.isPrivate) {
        await tx
          .insert(chatGroupMembers)
          .values({ groupId, userId: targetUserId, role: "member" })
          .onConflictDoNothing();
      }
      result = { unbanned: true };
    } else if (action === "kick") {
      await tx
        .delete(chatGroupMembers)
        .where(
          and(
            eq(chatGroupMembers.groupId, groupId),
            eq(chatGroupMembers.userId, targetUserId),
          ),
        );
      result = { removed: true };
    }

    await tx.insert(chatModerationActions).values({
      action,
      actorUserId: actor.id,
      targetUserId,
      groupId,
      reason: reason || null,
    });
  });

  await db.update(chatGroups).set({ updatedAt: new Date() }).where(eq(chatGroups.id, groupId));
  return { action, groupId, targetUserId, affectedChannelIds, ...result };
}
