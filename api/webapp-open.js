// api/webapp-open.js
import { db } from "../db/client.js";
import { webappOpens } from "../db/schema.js";
import { setCors } from "./utils/cors.js";

export default async function handler(req, res) {
  // CORS
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { tgId, username, firstName, lastName } = req.body || {};

    // tgId — обязателен и должен быть числом
    const tgIdNum = Number(tgId);
    if (!Number.isInteger(tgIdNum) || tgIdNum <= 0) {
      return res.status(400).json({ error: "Invalid tgId" });
    }

    // лёгкая санитария строк
    const safeUsername =
      typeof username === "string" && username.length <= 64 ? username : null;

    const safeFirstName =
      typeof firstName === "string" && firstName.length <= 64
        ? firstName
        : null;

    const safeLastName =
      typeof lastName === "string" && lastName.length <= 64 ? lastName : null;

    await db.insert(webappOpens).values({
      tgId: tgIdNum,
      username: safeUsername,
      firstName: safeFirstName,
      lastName: safeLastName,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[wr-api] /api/webapp-open error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
