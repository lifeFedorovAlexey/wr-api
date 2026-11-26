import { kickChatMember } from "../lib/chatModeration.mjs";
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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const result = await kickChatMember(session.user.id, req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "chat_member_kick_failed";
    const status = code === "chat_group_forbidden" ? 403 : 400;
    return res.status(status).json({ error: code });
  }
}

