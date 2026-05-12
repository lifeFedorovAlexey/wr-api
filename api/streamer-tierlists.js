import { setCors } from "./utils/cors.js";
import {
  getCurrentStreamerTierlist,
  isValidStreamerTierlistRequest,
  listLatestStreamerTierlists,
} from "../lib/streamerTierlists.mjs";

function setPublicCache(res, { sMaxAge = 300, swr = 1800 } = {}) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`,
  );
}

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

  try {
    const siteUserId = isValidStreamerTierlistRequest(req.query || {});

    if (siteUserId) {
      const payload = await getCurrentStreamerTierlist(siteUserId);
      if (!payload) {
        setNoStore(res);
        return res.status(404).json({ error: "streamer_tierlist_not_found" });
      }

      setNoStore(res);
      return res.status(200).json(payload);
    }

    const streamers = await listLatestStreamerTierlists();
    setPublicCache(res, { sMaxAge: 300, swr: 1800 });
    return res.status(200).json({ streamers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "streamer_tierlists_failed";
    const status =
      code === "invalid_site_user"
        ? 400
        : code === "site_user_not_found"
          ? 404
          : 500;

    if (status >= 500) {
      console.error("[wr-api] /api/streamer-tierlists error:", error);
    }

    setNoStore(res);
    return res.status(status).json({ error: code });
  }
}
