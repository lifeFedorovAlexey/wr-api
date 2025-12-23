// api/updated-at.js
import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";
import { max } from "drizzle-orm";
import { setCors } from "./utils/cors.js";

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
    const rows = await db
      .select({ lastDate: max(championStatsHistory.date) })
      .from(championStatsHistory);

    const lastDate = rows[0]?.lastDate || null;

    // lastDate у тебя pgDate → строка 'YYYY-MM-DD'
    return res.status(200).json({
      updatedAt: lastDate, // например "2025-12-05"
    });
  } catch (e) {
    console.error("[wr-api] /api/updated-at error:", e);
    setNoStore(res);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: e.message });
  }
}
