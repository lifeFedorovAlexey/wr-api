import { importGuidePayload } from "../lib/guideImport.mjs";
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

  if (!ensureAuthorized(req, res, AUTH_PROFILES.guidesSync)) {
    return;
  }

  const guide = req.body?.guide;

  if (!guide?.champion?.slug || !guide?.champion?.name) {
    setNoStore(res);
    return res.status(400).json({ error: "Invalid guide payload" });
  }

  try {
    const result = await importGuidePayload(guide);
    setNoStore(res);
    return res.status(200).json(result);
  } catch (error) {
    console.error("[wr-api] /api/guides/import error:", error);
    setNoStore(res);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
