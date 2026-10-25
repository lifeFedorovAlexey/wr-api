import "dotenv/config";
import { client } from "../db/client.js";
import { setupLuxChat } from "../lib/lux/chat-queue.mjs";

try {
  await setupLuxChat(client);
  console.log("Lux participant and per-user memory are ready");
} finally {
  await client.end();
}
