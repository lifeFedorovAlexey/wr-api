import { createChatMessage } from "../lib/chatGroups.mjs";
import { normalizeChatSharedSecret } from "../lib/chatAuth.mjs";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function isAuthorized(req, env = process.env) {
  const expected = normalizeChatSharedSecret(env);
  const actual = String(req.headers["x-wr-chat-secret"] || "").trim();
  return Boolean(expected && actual && expected === actual);
}

export default async function handler(req, res) {
  setNoStore(res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!isAuthorized(req, process.env)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = Number(req.body?.userId || 0);
    const message = await createChatMessage(userId, req.body || {});
    return res.status(201).json({ message });
  } catch (error) {
    const code = error instanceof Error ? error.message : "chat_message_create_failed";
    const status = code === "chat_channel_forbidden" ? 403 : 400;
    return res.status(status).json({ error: code });
  }
}

