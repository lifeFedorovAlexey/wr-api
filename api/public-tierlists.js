import { setCors } from "./utils/cors.js";
import { consumePublicTierlistCreateAttempt } from "../lib/publicTierlistRateLimit.mjs";
import { getRequestIp } from "../lib/sessionAuthShared.mjs";
import {
  cleanupExpiredAnonymousPublicTierlists,
  getPublicTierlistById,
  loadPublicTierlistEditor,
  publishPublicTierlist,
} from "../lib/streamerTierlists.mjs";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function readHeader(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value || null;
}

function statusForError(code) {
  if (["invalid_public_id", "missing_author_name"].includes(code)) return 400;
  if (["invalid_edit_token", "public_tierlist_edit_forbidden"].includes(code)) return 403;
  if (["tierlist_not_found"].includes(code)) return 404;
  return 500;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  setNoStore(res);

  try {
    await cleanupExpiredAnonymousPublicTierlists();

    if (req.method === "GET") {
      const publicId = String(req.query?.publicId || "").trim() || null;
      if (String(req.query?.editor || "") === "1") {
        const payload = await loadPublicTierlistEditor({
          publicId,
          editToken: readHeader(req, "x-tierlist-edit-token"),
        });
        return res.status(200).json(payload);
      }

      if (!publicId) return res.status(400).json({ error: "invalid_public_id" });
      const payload = await getPublicTierlistById(publicId);
      if (!payload) return res.status(404).json({ error: "tierlist_not_found" });
      return res.status(200).json(payload);
    }

    if (req.method === "POST") {
      const isPublicCreate = !String(req.body?.publicId || "").trim();
      if (isPublicCreate) {
        const rateLimit = consumePublicTierlistCreateAttempt(getRequestIp(req));
        if (!rateLimit.allowed) {
          res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
          return res.status(429).json({ error: "public_tierlist_create_rate_limited" });
        }
      }

      const result = await publishPublicTierlist(req.body || {}, {
        siteUser: null,
        editToken: readHeader(req, "x-tierlist-edit-token"),
      });
      return res.status(result.publishAction === "created" ? 201 : 200).json(result);
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "public_tierlist_failed";
    const status = statusForError(code);
    if (status >= 500) console.error("[wr-api] /api/public-tierlists error:", error);
    return res.status(status).json({ error: code });
  }
}
