import { listChatChannelsForUser } from "../lib/chatGroups.mjs";
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

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  const groupId = Number(req.query?.groupId || 0);
  if (!groupId) {
    return res.status(400).json({ error: "chat_group_required" });
  }

  try {
    const channels = await listChatChannelsForUser(session.user.id, groupId);
    return res.status(200).json({ channels });
  } catch (error) {
    return res.status(403).json({
      error: error instanceof Error ? error.message : "chat_group_forbidden",
    });
  }
}

