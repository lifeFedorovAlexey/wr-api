import { getChatChannelAccessForUser } from "../lib/chatGroups.mjs";
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
    const access = await getChatChannelAccessForUser(req.body?.userId, req.body?.channelId);
    return res.status(200).json({
      ok: true,
      channel: access.channel,
      membership: access.membership,
    });
  } catch (error) {
    return res.status(403).json({
      error: error instanceof Error ? error.message : "chat_channel_forbidden",
    });
  }
}
