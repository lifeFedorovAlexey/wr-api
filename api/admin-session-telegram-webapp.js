import {
  exchangeAdminIdentityForSession,
  getAdminSessionFromRequest,
  userHasAnyRole,
} from "../lib/adminAuth.mjs";
import { setCors } from "./utils/cors.js";
import {
  buildTelegramAuthProfileFromInitData,
  verifyTelegramInitData,
} from "./utils/telegram.js";

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

  const initData = String(req.body?.initData || "").trim();
  if (!initData) {
    return res.status(400).json({ error: "telegram_missing_init_data" });
  }

  const botToken = String(process.env.ADMIN_TELEGRAM_BOT_TOKEN || "").trim();
  if (!botToken) {
    return res.status(503).json({ error: "telegram_not_configured" });
  }

  const verified = verifyTelegramInitData(initData, botToken);
  if (!verified.ok) {
    return res.status(401).json({ error: `telegram_${verified.reason || "bad_hash"}` });
  }

  const profile = buildTelegramAuthProfileFromInitData(initData);
  if (!profile) {
    return res.status(400).json({ error: "telegram_invalid_user" });
  }

  const currentSession = await getAdminSessionFromRequest(req);
  const linkToUserId =
    currentSession && userHasAnyRole(currentSession.user, ["owner", "admin"])
      ? currentSession.user.id
      : null;

  const result = await exchangeAdminIdentityForSession(profile, req, process.env, {
    linkToUserId,
  });

  if (!result.ok) {
    return res.status(403).json({ error: result.error || "admin_not_allowed" });
  }

  return res.status(200).json({
    ok: true,
    sessionToken: result.sessionToken,
    user: result.user,
  });
}
