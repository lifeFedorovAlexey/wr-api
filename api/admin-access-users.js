import {
  listAccessUsers,
  updateSiteUserAccessRoles,
  userHasAnyRole,
  getAdminSessionFromRequest,
} from "../lib/adminAuth.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function getStatusCode(errorCode) {
  switch (errorCode) {
    case "invalid_site_user":
    case "site_user_identities_required":
      return 400;
    case "site_user_not_found":
      return 404;
    case "admin_identity_conflict":
    case "last_owner_required":
      return 409;
    default:
      return 500;
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  setNoStore(res);

  const session = await getAdminSessionFromRequest(req);
  if (!session || !userHasAnyRole(session.user, ["owner"])) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (req.method === "GET") {
    const users = await listAccessUsers();
    return res.status(200).json({ users });
  }

  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const siteUserId = req.body?.siteUserId;
    const roleKeys = req.body?.roleKeys;
    const user = await updateSiteUserAccessRoles(siteUserId, roleKeys);
    return res.status(200).json({ ok: true, user });
  } catch (error) {
    const errorCode = error?.code || "access_update_failed";
    return res.status(getStatusCode(errorCode)).json({ error: errorCode });
  }
}
