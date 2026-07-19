import { applyChatModerationAction } from "../lib/chatAdminModeration.mjs";
import { normalizeChatSharedSecret } from "../lib/chatAuth.mjs";
import { getChatErrorResponse } from "../lib/chatErrors.mjs";

function isAuthorized(req, env = process.env) {
  const expected = normalizeChatSharedSecret(env);
  const actual = String(req.headers["x-wr-chat-secret"] || "").trim();
  return Boolean(expected && actual && expected === actual);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!isAuthorized(req, process.env)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await applyChatModerationAction(
      {
        id: Number(req.body?.actorUserId || 0),
        roles: Array.isArray(req.body?.actorRoles) ? req.body.actorRoles : [],
      },
      req.body || {},
    );
    return res.status(200).json({ result });
  } catch (error) {
    const response = getChatErrorResponse(error, "chat_moderation_failed");
    return res.status(response.status).json(response.payload);
  }
}
