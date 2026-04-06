import {
  getSiteUserSessionFromRequest,
  updateSiteUserProfile,
} from "../lib/siteUserAuth.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET" && req.method !== "PATCH") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  setNoStore(res);

  const session = await getSiteUserSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, user: session.user });
  }

  const user = await updateSiteUserProfile(session.user.id, req.body || {});
  return res.status(200).json({ ok: true, user });
}
