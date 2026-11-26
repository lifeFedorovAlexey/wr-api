import { getAdminSessionFromRequest, listAdminUsers, userHasAnyRole } from "../lib/adminAuth.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  setNoStore(res);

  const session = await getAdminSessionFromRequest(req);
  if (!session || !userHasAnyRole(session.user, ["owner", "admin"])) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const users = await listAdminUsers();
  return res.status(200).json({ users });
}
