import "dotenv/config";

import { pathToFileURL } from "node:url";
import { inArray, lte, or } from "drizzle-orm";
import { client, db } from "../db/client.js";
import { chatMessageAttachments, chatMessages } from "../db/schema.js";
import { CHAT_CONTENT_RETENTION_DAYS } from "../lib/chatAttachments.mjs";
import { createObjectStorageClient } from "../lib/objectStorage.mjs";

export async function cleanupChatHistory({ now = new Date(), env = process.env } = {}) {
  const cutoff = new Date(
    now.getTime() - CHAT_CONTENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  const expiredMessages = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(lte(chatMessages.createdAt, cutoff));
  const messageIds = expiredMessages.map((row) => row.id);
  const attachmentCondition = messageIds.length
    ? or(
        lte(chatMessageAttachments.expiresAt, now),
        inArray(chatMessageAttachments.messageId, messageIds),
      )
    : lte(chatMessageAttachments.expiresAt, now);
  const attachments = await db
    .select({ id: chatMessageAttachments.id, objectKey: chatMessageAttachments.objectKey })
    .from(chatMessageAttachments)
    .where(attachmentCondition);

  await db.transaction(async (tx) => {
    if (attachments.length) {
      await tx
        .delete(chatMessageAttachments)
        .where(inArray(chatMessageAttachments.id, attachments.map((row) => row.id)));
    }
    await tx.delete(chatMessages).where(lte(chatMessages.createdAt, cutoff));
  });

  const storage = createObjectStorageClient(env);
  const objectKeys = attachments.map((row) => row.objectKey).filter(Boolean);
  const deletedObjects = storage && objectKeys.length ? await storage.deleteObjects(objectKeys) : 0;

  return {
    cutoff: cutoff.toISOString(),
    deletedMessages: messageIds.length,
    deletedAttachmentRows: attachments.length,
    deletedObjects,
  };
}

async function main() {
  const result = await cleanupChatHistory();
  console.log("[chat-cleanup] done", JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("[chat-cleanup] failed", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.end({ timeout: 5 });
    });
}
