import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  chatGroupBans,
  chatGroupInvites,
  chatGroupMembers,
  chatGroups,
} from "../db/schema.js";

function normalizeReason(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 300);
}

function canModerate(actorRole, targetRole) {
  if (actorRole === "owner") {
    return targetRole !== "owner";
  }

  if (actorRole === "admin") {
    return targetRole === "member";
  }

  return false;
}

async function getMembership(groupId, userId) {
  const [membership] = await db
    .select({
      groupId: chatGroupMembers.groupId,
      userId: chatGroupMembers.userId,
      role: chatGroupMembers.role,
    })
    .from(chatGroupMembers)
    .where(and(eq(chatGroupMembers.groupId, groupId), eq(chatGroupMembers.userId, userId)))
    .limit(1);

  return membership || null;
}

async function getBan(groupId, userId) {
  const [ban] = await db
    .select({
      groupId: chatGroupBans.groupId,
      userId: chatGroupBans.userId,
    })
    .from(chatGroupBans)
    .where(and(eq(chatGroupBans.groupId, groupId), eq(chatGroupBans.userId, userId)))
    .limit(1);

  return ban || null;
}

async function requireModerator(groupId, actorUserId) {
  const actor = await getMembership(groupId, actorUserId);
  if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
    throw new Error("chat_group_forbidden");
  }

  const actorBan = await getBan(groupId, actorUserId);
  if (actorBan) {
    throw new Error("chat_group_forbidden");
  }

  return actor;
}

export async function listPendingInvitesForUser(userId) {
  return await db
    .select({
      id: chatGroupInvites.id,
      groupId: chatGroupInvites.groupId,
      inviterUserId: chatGroupInvites.inviterUserId,
      inviteeUserId: chatGroupInvites.inviteeUserId,
      status: chatGroupInvites.status,
      createdAt: chatGroupInvites.createdAt,
      respondedAt: chatGroupInvites.respondedAt,
    })
    .from(chatGroupInvites)
    .where(and(eq(chatGroupInvites.inviteeUserId, userId), eq(chatGroupInvites.status, "pending")))
    .orderBy(desc(chatGroupInvites.createdAt), desc(chatGroupInvites.id));
}

export async function createChatInvite(actorUserId, input = {}) {
  const groupId = Number(input.groupId || 0);
  const inviteeUserId = Number(input.inviteeUserId || 0);

  if (!groupId || !inviteeUserId) {
    throw new Error("chat_invite_invalid");
  }

  if (actorUserId === inviteeUserId) {
    throw new Error("chat_invite_invalid");
  }

  const actor = await requireModerator(groupId, actorUserId);
  const [group] = await db.select().from(chatGroups).where(eq(chatGroups.id, groupId)).limit(1);
  if (!group) {
    throw new Error("chat_group_not_found");
  }

  const inviteeMembership = await getMembership(groupId, inviteeUserId);
  if (inviteeMembership) {
    throw new Error("chat_invite_already_member");
  }

  const inviteeBan = await getBan(groupId, inviteeUserId);
  if (inviteeBan) {
    throw new Error("chat_invite_banned");
  }

  const [existingInvite] = await db
    .select()
    .from(chatGroupInvites)
    .where(
      and(
        eq(chatGroupInvites.groupId, groupId),
        eq(chatGroupInvites.inviteeUserId, inviteeUserId),
        eq(chatGroupInvites.status, "pending"),
      ),
    )
    .limit(1);

  if (existingInvite) {
    return existingInvite;
  }

  const [invite] = await db
    .insert(chatGroupInvites)
    .values({
      groupId,
      inviterUserId: actor.userId,
      inviteeUserId,
      status: "pending",
    })
    .returning();

  await db
    .update(chatGroups)
    .set({ updatedAt: new Date() })
    .where(eq(chatGroups.id, groupId));

  return invite;
}

export async function respondToChatInvite(userId, input = {}) {
  const inviteId = Number(input.inviteId || 0);
  const action = String(input.action || "").trim().toLowerCase();

  if (!inviteId || (action !== "accept" && action !== "decline")) {
    throw new Error("chat_invite_invalid");
  }

  const [invite] = await db
    .select()
    .from(chatGroupInvites)
    .where(eq(chatGroupInvites.id, inviteId))
    .limit(1);

  if (!invite || invite.inviteeUserId !== userId) {
    throw new Error("chat_invite_not_found");
  }

  if (invite.status !== "pending") {
    throw new Error("chat_invite_not_pending");
  }

  if (action === "accept") {
    const ban = await getBan(invite.groupId, userId);
    if (ban) {
      throw new Error("chat_group_forbidden");
    }

    const membership = await getMembership(invite.groupId, userId);
    if (!membership) {
      await db.insert(chatGroupMembers).values({
        groupId: invite.groupId,
        userId,
        role: "member",
      });
    }
  }

  const [updatedInvite] = await db
    .update(chatGroupInvites)
    .set({
      status: action === "accept" ? "accepted" : "declined",
      respondedAt: new Date(),
    })
    .where(eq(chatGroupInvites.id, inviteId))
    .returning();

  await db
    .update(chatGroups)
    .set({ updatedAt: new Date() })
    .where(eq(chatGroups.id, invite.groupId));

  return updatedInvite;
}

export async function kickChatMember(actorUserId, input = {}) {
  const groupId = Number(input.groupId || 0);
  const targetUserId = Number(input.targetUserId || 0);

  if (!groupId || !targetUserId || actorUserId === targetUserId) {
    throw new Error("chat_member_kick_invalid");
  }

  const actor = await requireModerator(groupId, actorUserId);
  const target = await getMembership(groupId, targetUserId);

  if (!target) {
    throw new Error("chat_member_not_found");
  }

  if (!canModerate(actor.role, target.role)) {
    throw new Error("chat_group_forbidden");
  }

  await db
    .delete(chatGroupMembers)
    .where(
      and(eq(chatGroupMembers.groupId, groupId), eq(chatGroupMembers.userId, targetUserId)),
    );

  await db
    .update(chatGroups)
    .set({ updatedAt: new Date() })
    .where(eq(chatGroups.id, groupId));

  return {
    groupId,
    targetUserId,
    removed: true,
  };
}

export async function banChatMember(actorUserId, input = {}) {
  const groupId = Number(input.groupId || 0);
  const targetUserId = Number(input.targetUserId || 0);
  const reason = normalizeReason(input.reason);

  if (!groupId || !targetUserId || actorUserId === targetUserId) {
    throw new Error("chat_ban_invalid");
  }

  const actor = await requireModerator(groupId, actorUserId);
  const targetMembership = await getMembership(groupId, targetUserId);

  if (targetMembership && !canModerate(actor.role, targetMembership.role)) {
    throw new Error("chat_group_forbidden");
  }

  const [ban] = await db
    .insert(chatGroupBans)
    .values({
      groupId,
      userId: targetUserId,
      bannedByUserId: actorUserId,
      reason: reason || null,
    })
    .onConflictDoUpdate({
      target: [chatGroupBans.groupId, chatGroupBans.userId],
      set: {
        bannedByUserId: actorUserId,
        reason: reason || null,
        createdAt: new Date(),
      },
    })
    .returning();

  await db
    .delete(chatGroupMembers)
    .where(
      and(eq(chatGroupMembers.groupId, groupId), eq(chatGroupMembers.userId, targetUserId)),
    );

  await db
    .update(chatGroups)
    .set({ updatedAt: new Date() })
    .where(eq(chatGroups.id, groupId));

  return ban;
}

