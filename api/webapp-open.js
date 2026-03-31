// api/webapp-open.js
import { db } from "../db/client.js";
import { webappOpens } from "../db/schema.js";
import { setCors } from "./utils/cors.js";
import {
  extractTelegramUser,
  verifyTelegramInitData,
} from "./utils/telegram.js";

function setNoStore(res) {
  // POST-эндпоинты не должны попадать в CDN-кеш.
  res.setHeader("Cache-Control", "no-store");
}

function sanitizeName(value) {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > 64) return null;
  if (/^(.)\1+$/.test(value)) return null;
  return value;
}

export default async function handler(req, res) {
  // CORS
  setCors(req, res);
  setNoStore(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const initData = String(req.headers["x-telegram-init-data"] || "").trim();
    if (!initData) {
      return res.status(401).json({ error: "Missing Telegram init data" });
    }

    const verified = verifyTelegramInitData(
      initData,
      process.env.TELEGRAM_BOT_TOKEN,
    );
    if (!verified.ok) {
      return res.status(401).json({ error: "Invalid Telegram init data" });
    }

    const user = extractTelegramUser(initData);
    const tgIdNum = Number(user?.id);
    if (!Number.isInteger(tgIdNum) || tgIdNum <= 0) {
      return res.status(400).json({ error: "Invalid Telegram user" });
    }

    const safeUsername = sanitizeName(user?.username);
    const safeFirstName = sanitizeName(user?.first_name);
    const safeLastName = sanitizeName(user?.last_name);

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
