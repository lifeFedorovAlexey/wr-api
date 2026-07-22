import "dotenv/config";

import { createObjectStorageClient } from "../lib/objectStorage.mjs";

async function main() {
  const storage = createObjectStorageClient(process.env);
  if (!storage) throw new Error("quiz_media_storage_unavailable");

  const allowedOrigins = String(
    process.env.QUIZ_MEDIA_ALLOWED_ORIGINS ||
      "https://wildriftallstats.ru,http://localhost:3000",
  )
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const corsRule = await storage.ensureCorsRule({
    id: "quiz-media-browser-upload",
    allowedOrigins,
  });
  console.log("[quiz-media-storage] ready", JSON.stringify({ corsRule }));
}

main().catch((error) => {
  console.error("[quiz-media-storage] failed", error);
  process.exitCode = 1;
});
