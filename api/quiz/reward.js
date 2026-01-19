import { db } from "../../db/client.js";
import { setCors } from "../utils/cors.js";
import {
  verifyTelegramInitData,
  extractTelegramUserId,
} from "../utils/telegram.js";
import { quizAttempts } from "../../db/schema_quiz.js"; // <-- подстрой под свой путь
import { and, eq } from "drizzle-orm";

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

const QUIZ_KEY = "lol_quiz";

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

  const rewardUrl = process.env.QUIZ_REWARD_URL; // <-- тут твоя t.me/+...
  if (!rewardUrl) {
    return res.status(500).json({ error: "Missing QUIZ_REWARD_URL" });
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

    if (!rows.length) {
      return res
        .status(403)
        .json({ error: "Forbidden", reason: "no_attempts" });
    }

    const lastPercent = rows[0].lastPercent ?? null;

    // ✅ правило: ссылка только если последний результат 100%
    if (lastPercent !== 100) {
      return res.status(403).json({ error: "Forbidden", reason: "not_winner" });
    }

    return res.status(200).json({
      ok: true,
      url: rewardUrl,
    });
  } catch (e) {
    console.error("[api] /api/quiz/reward error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
