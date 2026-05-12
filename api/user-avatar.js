import {
  getSiteUserSessionFromRequest,
  uploadSiteUserAvatar,
} from "../lib/siteUserAuth.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function getStatusCode(code) {
  switch (code) {
    case "invalid_site_user":
    case "invalid_avatar_image":
    case "avatar_too_large":
    case "invalid_avatar_url":
      return 400;
    case "avatar_storage_unavailable":
      return 503;
    default:
      return 500;
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  setNoStore(res);

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const payload = await uploadSiteUserAvatar(session.user.id, req.body?.imageBase64, {
      env: process.env,
    });
    return res.status(200).json({ ok: true, ...payload });
  } catch (error) {
    const code = error instanceof Error ? error.message : "avatar_upload_failed";
    return res.status(getStatusCode(code)).json({ error: code });
  }
}
