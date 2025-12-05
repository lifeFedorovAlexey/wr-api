import { db } from "../db/client.js";
import { webappOpens } from "../db/schema.js";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { tgId, username, firstName, lastName } = req.body || {};

    if (!tgId) {
      return res.status(400).json({ error: "tgId is required" });
    }

    await db.insert(webappOpens).values({
      tgId: Number(tgId),
      username: username || null,
      firstName: firstName || null,
      lastName: lastName || null,
      // openedAt проставится default now()
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[wr-api] /api/webapp-open error:", e);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: e.message });
  }
}
