// api/updated-at.js
import { setCors } from "./utils/cors.js";
import { getLatestCompletedChampionStatsSnapshot } from "../lib/statsSnapshots.mjs";

function setPublicCache(res, { sMaxAge = 60, swr = 300 } = {}) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`
  );
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(req, res);
  setPublicCache(res, { sMaxAge: 60, swr: 300 });

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    setNoStore(res);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const latestSnapshot = await getLatestCompletedChampionStatsSnapshot();

    return res.status(200).json({
      updatedAt: latestSnapshot?.completedAt || null,
      statsDate: latestSnapshot?.statsDate || null,
    });
  } catch (e) {
    console.error("[wr-api] /api/updated-at error:", e);
    setNoStore(res);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: e.message });
  }
}
