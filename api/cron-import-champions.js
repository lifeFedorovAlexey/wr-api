// api/cron-import-champions.js
// Legacy HTTP entrypoint for manual/remote cron triggering.

import { updateChampions } from "../lib/updateChampions.mjs";
import { ensureAuthorized } from "./utils/adminAuth.js";
import { AUTH_PROFILES } from "./utils/authProfiles.js";
import { setCors } from "./utils/cors.js";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!ensureAuthorized(req, res, AUTH_PROFILES.championsSync)) {
    return;
  }

  try {
    const report = await updateChampions();
    setNoStore(res);
    res.status(200).json({ ok: true, report });
  } catch (e) {
    console.error("[cron] error:", e);
    setNoStore(res);
    res.status(500).json({ ok: false, error: String(e) });
  }
}
