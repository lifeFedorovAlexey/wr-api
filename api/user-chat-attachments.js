import { createChatAttachmentUpload } from "../lib/chatAttachments.mjs";
import { getChatErrorResponse } from "../lib/chatErrors.mjs";
import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import { setCors } from "./utils/cors.js";

export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  try {
    const result = await createChatAttachmentUpload(session.user, req.body || {}, process.env);
    return res.status(201).json(result);
  } catch (error) {
    const response = getChatErrorResponse(error, "chat_attachment_create_failed");
    return res.status(response.status).json(response.payload);
  }
}
