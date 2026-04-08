import { getAdminSessionFromRequest } from "../lib/adminAuth.mjs";
import {
  resolveSiteUserViewForAdminUser,
  updateSiteProfileForAdminUser,
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

  const session = await getAdminSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET") {
    const user = await resolveSiteUserViewForAdminUser(session.user.id);
    return res.status(200).json({ ok: true, user });
  }

  try {
    const user = await updateSiteProfileForAdminUser(session.user.id, req.body || {});
    return res.status(200).json({ ok: true, user });
  } catch (error) {
    const code = error instanceof Error ? error.message : "profile_update_failed";

    if (code === "invalid_wild_rift_handle" || code === "invalid_peak_rank") {
      return res.status(400).json({ error: code });
    }

    return res.status(500).json({ error: "profile_update_failed" });
  }
}
