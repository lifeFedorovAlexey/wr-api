import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  chatAntispamStates,
  chatModerationActions,
  chatMutes,
} from "../db/schema.js";
import { ChatDomainError } from "./chatErrors.mjs";
import {
  calculateAntispamMuteSeconds,
  calculateNextAntispamPenalty,
  CHAT_SPAM_INITIAL_MUTE_SECONDS,
  CHAT_SPAM_MAX_MUTE_SECONDS,
  CHAT_SPAM_MESSAGE_LIMIT,
  CHAT_SPAM_RESET_MS,
  CHAT_SPAM_WINDOW_MS,
} from "./chatPolicy.mjs";

export {
  calculateAntispamMuteSeconds,
  calculateNextAntispamPenalty,
  CHAT_SPAM_INITIAL_MUTE_SECONDS,
  CHAT_SPAM_MAX_MUTE_SECONDS,
  CHAT_SPAM_MESSAGE_LIMIT,
  CHAT_SPAM_RESET_MS,
  CHAT_SPAM_WINDOW_MS,
};

const attemptWindows = new Map();

function buildAttemptKey(groupId, userId) {
  return `${Number(groupId)}:${Number(userId)}`;
}

export function formatChatMute(mute) {
  if (!mute) return null;
  return {
    id: Number(mute.id || 0),
    groupId: Number(mute.groupId || 0),
    userId: Number(mute.userId || 0),
    source: String(mute.source || "manual"),
    reason: mute.reason ? String(mute.reason) : null,
    startsAt: mute.startsAt,
    expiresAt: mute.expiresAt,
  };
}

export async function getActiveChatMute(groupId, userId, { executor = db, now = new Date() } = {}) {
  const [mute] = await executor
    .select()
    .from(chatMutes)
    .where(
      and(
        eq(chatMutes.groupId, Number(groupId)),
        eq(chatMutes.userId, Number(userId)),
        isNull(chatMutes.revokedAt),
        gt(chatMutes.expiresAt, now),
      ),
    )
    .orderBy(desc(chatMutes.expiresAt), desc(chatMutes.id))
    .limit(1);

  return mute || null;
}

export async function assertChatUserNotMuted(groupId, userId, options = {}) {
  const mute = await getActiveChatMute(groupId, userId, options);
  if (!mute) return null;

  throw new ChatDomainError("chat_muted", {
    status: 429,
    details: { mute: formatChatMute(mute) },
  });
}

async function applyAutomaticMute(groupId, userId, now) {
  const [state] = await db
    .select()
    .from(chatAntispamStates)
    .where(
      and(
        eq(chatAntispamStates.groupId, groupId),
        eq(chatAntispamStates.userId, userId),
      ),
    )
    .limit(1);

  const { escalationLevel, durationSeconds } = calculateNextAntispamPenalty(state, now);
  const expiresAt = new Date(now.getTime() + durationSeconds * 1_000);

  await db
    .insert(chatAntispamStates)
    .values({
      groupId,
      userId,
      escalationLevel,
      lastViolationAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [chatAntispamStates.groupId, chatAntispamStates.userId],
      set: {
        escalationLevel,
        lastViolationAt: now,
        updatedAt: now,
      },
    });

  const [mute] = await db
    .insert(chatMutes)
    .values({
      groupId,
      userId,
      mutedByUserId: null,
      source: "antispam",
      reason: "10 сообщений за 5 секунд",
      startsAt: now,
      expiresAt,
    })
    .returning();

  await db.insert(chatModerationActions).values({
    action: "mute",
    actorUserId: null,
    targetUserId: userId,
    groupId,
    reason: "antispam",
    durationSeconds,
    metadata: {
      source: "antispam",
      escalationLevel,
      messageLimit: CHAT_SPAM_MESSAGE_LIMIT,
      windowMs: CHAT_SPAM_WINDOW_MS,
    },
  });

  return formatChatMute(mute);
}

export async function registerChatMessageAttempt(groupIdInput, userIdInput, nowInput = new Date()) {
  const groupId = Number(groupIdInput || 0);
  const userId = Number(userIdInput || 0);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const nowMs = now.getTime();

  if (!groupId || !userId || !Number.isFinite(nowMs)) {
    throw new Error("chat_antispam_invalid");
  }

  const key = buildAttemptKey(groupId, userId);
  const cutoff = nowMs - CHAT_SPAM_WINDOW_MS;
  const attempts = (attemptWindows.get(key) || []).filter((timestamp) => timestamp > cutoff);
  attempts.push(nowMs);

  if (attempts.length < CHAT_SPAM_MESSAGE_LIMIT) {
    attemptWindows.set(key, attempts);
    return null;
  }

  attemptWindows.delete(key);
  const mute = await applyAutomaticMute(groupId, userId, now);
  throw new ChatDomainError("chat_antispam_muted", {
    status: 429,
    details: {
      mute,
      warning: "Слишком много сообщений. Отправка временно приостановлена.",
    },
  });
}

export function resetChatAntispamAttempts() {
  attemptWindows.clear();
}
