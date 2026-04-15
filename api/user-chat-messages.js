import {
  createChatMessage,
  listChatMessagesForUser,
} from "../lib/chatGroups.mjs";
import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  setNoStore(res);

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  if (req.method === "GET") {
    const channelId = Number(req.query?.channelId || 0);
    const limit = Number(req.query?.limit || 50);

    if (!channelId) {
      return res.status(400).json({ error: "chat_channel_required" });
    }

    try {
      const messages = await listChatMessagesForUser(session.user.id, channelId, { limit });
      return res.status(200).json({ messages });
    } catch (error) {
      return res.status(403).json({
        error: error instanceof Error ? error.message : "chat_channel_forbidden",
      });
    }
  }

  if (req.method === "POST") {
    try {
      const message = await createChatMessage(session.user.id, req.body || {});
      return res.status(201).json({ message });
    } catch (error) {
      const code = error instanceof Error ? error.message : "chat_message_create_failed";
      const status = code === "chat_channel_forbidden" ? 403 : 400;
      return res.status(status).json({ error: code });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

