import { createChatGroup, listChatGroupsForUser } from "../lib/chatGroups.mjs";
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

  const session = await getSiteUserSessionFromRequest(req);
  setNoStore(res);

  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  if (req.method === "GET") {
    const groups = await listChatGroupsForUser(session.user.id);
    return res.status(200).json({ groups });
  }

  if (req.method === "POST") {
    try {
      const result = await createChatGroup(session.user.id, req.body || {});
      return res.status(201).json(result);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "chat_group_create_failed",
      });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

