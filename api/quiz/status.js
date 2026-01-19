import { db } from "../../db/client.js";
import { setCors } from "../utils/cors.js";
import {
  verifyTelegramInitData,
  extractTelegramUserId,
} from "../utils/telegram.js";
import { quizAttempts } from "../../db/schema_quiz.js";
import { and, eq } from "drizzle-orm";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

const QUIZ_KEY = "lol_quiz";
const MAX_ATTEMPTS = 3;

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  setNoStore(res);

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const botToken = process.env.TG_BOT_TOKEN;
  const initData = req.headers["x-telegram-init-data"];

  const ver = verifyTelegramInitData(initData, botToken);
  if (!ver.ok) {
    return res.status(401).json({ error: "Unauthorized", reason: ver.reason });
  }

  const telegramUserId = extractTelegramUserId(initData);
  if (!telegramUserId) {
    return res.status(400).json({ error: "Bad Request", reason: "no_user_id" });
  }

  try {
    const rows = await db
      .select()
      .from(quizAttempts)
      .where(
        and(
          eq(quizAttempts.telegramUserId, telegramUserId),
          eq(quizAttempts.quizKey, QUIZ_KEY),
        ),
      )
      .limit(1);

    const attempts = rows.length ? (rows[0].attempts ?? 0) : 0;
    const blocked = attempts >= MAX_ATTEMPTS;

    const lastPercent = rows.length ? (rows[0].lastPercent ?? null) : null;
    const lastCorrect = rows.length ? (rows[0].lastCorrect ?? null) : null;
    const lastTotal = rows.length ? (rows[0].lastTotal ?? null) : null;

    return res.status(200).json({
      telegramUserId,
      quizKey: QUIZ_KEY,
      attempts,
      maxAttempts: MAX_ATTEMPTS,
      blocked,
      last: {
        percent: lastPercent,
        correct: lastCorrect,
        total: lastTotal,
      },
    });
  } catch (e) {
    console.error("[api] /api/quiz/status error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
