import { createChatMessage, deleteChatMessage } from "../lib/chatGroups.mjs";
import { normalizeChatSharedSecret } from "../lib/chatAuth.mjs";
import { getChatErrorResponse } from "../lib/chatErrors.mjs";

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
    if (req.body?.action === "delete") {
      const deleted = await deleteChatMessage(
        {
          id: userId,
          roles: Array.isArray(req.body?.roles) ? req.body.roles : [],
        },
        req.body || {},
      );
      return res.status(200).json({ deleted });
    }

    const message = await createChatMessage(
      { id: userId, roles: Array.isArray(req.body?.roles) ? req.body.roles : [] },
      req.body || {},
    );
    return res.status(201).json({ message });
  } catch (error) {
    const response = getChatErrorResponse(error, "chat_message_create_failed");
    return res.status(response.status).json(response.payload);
  }
}

