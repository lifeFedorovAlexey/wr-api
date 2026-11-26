import {
  createChatInvite,
  listPendingInvitesForUser,
  respondToChatInvite,
} from "../lib/chatModeration.mjs";
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
    const invites = await listPendingInvitesForUser(session.user.id);
    return res.status(200).json({ invites });
  }

  if (req.method === "POST") {
    try {
      if (req.body?.action) {
        const invite = await respondToChatInvite(session.user.id, req.body || {});
        return res.status(200).json({ invite });
      }

      const invite = await createChatInvite(session.user.id, req.body || {});
      return res.status(201).json({ invite });
    } catch (error) {
      const code = error instanceof Error ? error.message : "chat_invite_failed";
      const status =
        code === "chat_group_forbidden" || code === "chat_invite_not_found" ? 403 : 400;
      return res.status(status).json({ error: code });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

