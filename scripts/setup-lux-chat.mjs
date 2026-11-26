import "dotenv/config";
import { client } from "../db/client.js";
import { createLuxChatQueue, setupLuxChat } from "../lib/lux/chat-queue.mjs";

try {
  await setupLuxChat(client);
  const recovered = await createLuxChatQueue(client).recoverRecent();
  console.log(`Lux participant and per-user memory are ready; recovered ${recovered} recent addresses`);
} finally {
  await client.end();
}
