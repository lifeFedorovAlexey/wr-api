// api/updated-at.js
import { db } from "../db/client.js";
import { championStatsHistory } from "../db/schema.js";
import { max } from "drizzle-orm";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=300"
  );

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
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
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: e.message });
  }
}
