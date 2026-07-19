import "dotenv/config";

import { createObjectStorageClient } from "../lib/objectStorage.mjs";

async function main() {
  const storage = createObjectStorageClient(process.env);
  if (!storage) {
    throw new Error("chat_media_storage_unavailable");
  }

  const lifecycleRule = await storage.ensureExpirationLifecycleRule({
    id: "chat-media-retention-90-days",
    prefix: "chat-media/",
    days: 90,
  });
  const allowedOrigins = String(
    process.env.CHAT_MEDIA_ALLOWED_ORIGINS ||
      "https://wildriftallstats.ru,http://localhost:3000",
  )
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const corsRule = await storage.ensureCorsRule({
    id: "chat-media-browser-access",
    allowedOrigins,
  });
  console.log(
    "[chat-media-lifecycle] ready",
    JSON.stringify({ lifecycleRule, corsRule }),
  );
}

main().catch((error) => {
  console.error("[chat-media-lifecycle] failed", error);
  process.exitCode = 1;
});
