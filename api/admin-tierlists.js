import { getAdminSessionFromRequest, userHasAnyRole } from "../lib/adminAuth.mjs";
import { listAllTierlistsForAdmin } from "../lib/streamerTierlists.mjs";
import { setCors } from "./utils/cors.js";

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "no-store");

  const session = await getAdminSessionFromRequest(req);
  if (!session || !userHasAnyRole(session.user, ["owner", "admin"])) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    return res.status(200).json({ tierlists: await listAllTierlistsForAdmin() });
  } catch (error) {
    console.error("[wr-api] /api/admin/tierlists error:", error);
    return res.status(500).json({ error: "admin_tierlists_failed" });
  }
}
