import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { chatMessageAttachments } from "../db/schema.js";
import { createObjectStorageClient } from "./objectStorage.mjs";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_CONTENT_RETENTION_DAYS,
  getChatMediaDefinition,
  normalizeChatMediaMimeType,
  validateChatAttachmentInput,
} from "./chatPolicy.mjs";

export {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_CONTENT_RETENTION_DAYS,
  validateChatAttachmentInput,
};

function getRetentionDate(from = new Date()) {
  return new Date(from.getTime() + CHAT_CONTENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
}

function requireStorage(env = process.env) {
  const storage = createObjectStorageClient(env);
  if (!storage) {
    throw new Error("chat_media_storage_unavailable");
  }
  return storage;
}

export async function createChatAttachmentUpload(actorInput, input = {}, env = process.env) {
  const userId = Number(actorInput?.id || actorInput || 0);
  const channelId = Number(input.channelId || 0);
  if (!userId || !channelId) {
    throw new Error("chat_attachment_invalid");
  }

  const { getChatChannelAccessForUser } = await import("./chatGroups.mjs");
  await getChatChannelAccessForUser(actorInput, channelId);
  const file = validateChatAttachmentInput(input);
  const storage = requireStorage(env);
  const now = new Date();
  const datePrefix = now.toISOString().slice(0, 7).replace("-", "/");
  const objectKey = `chat-media/${datePrefix}/${randomUUID()}${file.extension}`;

  const [attachment] = await db
    .insert(chatMessageAttachments)
    .values({
      messageId: null,
      channelId,
      uploaderUserId: userId,
      objectKey,
      fileName: file.fileName,
      mimeType: file.mimeType,
      mediaKind: file.kind,
      sizeBytes: file.sizeBytes,
      status: "pending",
      createdAt: now,
      expiresAt: getRetentionDate(now),
    })
    .returning();

  const uploadUrl = await storage.createPresignedUploadUrl(objectKey, file.mimeType, {
    expiresIn: 10 * 60,
  });

  return {
    attachment: {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      mediaKind: attachment.mediaKind,
      sizeBytes: attachment.sizeBytes,
      expiresAt: attachment.expiresAt,
    },
    upload: {
      url: uploadUrl,
      method: "PUT",
      headers: { "Content-Type": file.mimeType },
      expiresInSeconds: 10 * 60,
    },
  };
}

function normalizeAttachmentIds(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
}

export async function validatePendingChatAttachments(
  userIdInput,
  channelIdInput,
  attachmentIdsInput,
  env = process.env,
) {
  const attachmentIds = normalizeAttachmentIds(attachmentIdsInput);
  if (!attachmentIds.length) return [];

  const userId = Number(userIdInput || 0);
  const channelId = Number(channelIdInput || 0);
  const rows = await db
    .select()
    .from(chatMessageAttachments)
    .where(
      and(
        inArray(chatMessageAttachments.id, attachmentIds),
        eq(chatMessageAttachments.uploaderUserId, userId),
        eq(chatMessageAttachments.channelId, channelId),
        eq(chatMessageAttachments.status, "pending"),
        isNull(chatMessageAttachments.messageId),
        isNull(chatMessageAttachments.deletedAt),
        gt(chatMessageAttachments.expiresAt, new Date()),
      ),
    );

  if (rows.length !== attachmentIds.length) {
    throw new Error("chat_attachment_invalid");
  }

  const storage = requireStorage(env);
  await Promise.all(
    rows.map(async (row) => {
      const head = await storage.headObject(row.objectKey);
      const actualSize = Number(head?.ContentLength || 0);
      const actualMimeType = normalizeChatMediaMimeType(head?.ContentType);

      if (
        actualSize !== Number(row.sizeBytes) ||
        actualSize <= 0 ||
        actualSize > CHAT_ATTACHMENT_MAX_BYTES
      ) {
        throw new Error("chat_attachment_size_mismatch");
      }

      if (
        actualMimeType !== normalizeChatMediaMimeType(row.mimeType) ||
        !getChatMediaDefinition(actualMimeType)
      ) {
        throw new Error("chat_attachment_type_mismatch");
      }
    }),
  );

  return rows;
}

export async function attachChatAttachments(executor, messageId, attachmentRows) {
  if (!attachmentRows.length) return [];
  const ids = attachmentRows.map((row) => row.id);
  const now = new Date();
  return await executor
    .update(chatMessageAttachments)
    .set({ messageId, status: "attached", attachedAt: now })
    .where(
      and(
        inArray(chatMessageAttachments.id, ids),
        eq(chatMessageAttachments.status, "pending"),
      ),
    )
    .returning();
}

export async function markChatAttachmentsDeleted(executor, messageId, deletedAt) {
  return await executor
    .update(chatMessageAttachments)
    .set({ status: "deleted", deletedAt })
    .where(eq(chatMessageAttachments.messageId, Number(messageId)));
}

export async function listChatAttachmentsForMessages(messageIdsInput, env = process.env) {
  const messageIds = Array.from(
    new Set(
      (Array.isArray(messageIdsInput) ? messageIdsInput : [])
        .map((value) => Number(value || 0))
        .filter(Boolean),
    ),
  );
  if (!messageIds.length) return new Map();

  const rows = await db
    .select()
    .from(chatMessageAttachments)
    .where(
      and(
        inArray(chatMessageAttachments.messageId, messageIds),
        eq(chatMessageAttachments.status, "attached"),
        isNull(chatMessageAttachments.deletedAt),
        gt(chatMessageAttachments.expiresAt, new Date()),
      ),
    );

  const storage = createObjectStorageClient(env);
  const grouped = new Map(messageIds.map((messageId) => [messageId, []]));

  await Promise.all(
    rows.map(async (row) => {
      const url = storage
        ? await storage.createPresignedDownloadUrl(row.objectKey, { expiresIn: 15 * 60 })
        : null;
      grouped.get(row.messageId)?.push({
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        mediaKind: row.mediaKind,
        sizeBytes: row.sizeBytes,
        url,
        expiresAt: row.expiresAt,
      });
    }),
  );

  return grouped;
}
