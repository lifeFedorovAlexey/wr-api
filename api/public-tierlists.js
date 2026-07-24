import { setCors } from "./utils/cors.js";
import { getSiteUserSessionFromRequest } from "../lib/siteUserAuth.mjs";
import {
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
  if (["invalid_public_id"].includes(code)) return 400;
  if (["invalid_edit_token"].includes(code)) return 403;
  if (["tierlist_not_found"].includes(code)) return 404;
  return 500;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  setNoStore(res);

  try {
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
      const session = await getSiteUserSessionFromRequest(req);
      const result = await publishPublicTierlist(req.body || {}, {
        siteUser: session?.user || null,
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
