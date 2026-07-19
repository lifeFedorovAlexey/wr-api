import {
  applyChatModerationAction,
  listChatModerationState,
} from "../lib/chatAdminModeration.mjs";
import { getChatErrorResponse } from "../lib/chatErrors.mjs";
import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import { setCors } from "./utils/cors.js";

export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    if (req.method === "GET") {
      const state = await listChatModerationState(session.user, req.query?.groupId);
      return res.status(200).json(state);
    }

    if (req.method === "POST") {
      const result = await applyChatModerationAction(session.user, req.body || {});
      return res.status(200).json({ result });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    const response = getChatErrorResponse(error, "chat_moderation_failed");
    return res.status(response.status).json(response.payload);
  }
}
