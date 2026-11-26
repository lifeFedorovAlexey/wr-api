import {
  exchangeAdminIdentityForSession,
  getAdminSessionFromRequest,
  userHasAnyRole,
  verifySignedExchangeEnvelope,
} from "../lib/adminAuth.mjs";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
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

  const payload = String(req.body?.payload || "");
  const signature = String(req.body?.signature || "");
  const verified = verifySignedExchangeEnvelope(payload, signature, process.env);

  if (!verified?.profile) {
    return res.status(401).json({ error: "Invalid exchange envelope" });
  }

  const currentSession = await getAdminSessionFromRequest(req);
  const linkToUserId =
    currentSession && userHasAnyRole(currentSession.user, ["owner", "admin"])
      ? currentSession.user.id
      : null;

  const result = await exchangeAdminIdentityForSession(verified.profile, req, process.env, {
    linkToUserId,
  });
  if (!result.ok) {
    return res.status(403).json({ error: result.error || "Forbidden" });
  }

  return res.status(200).json({
    ok: true,
    sessionToken: result.sessionToken,
    user: result.user,
  });
}
