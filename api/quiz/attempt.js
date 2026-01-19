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
const MAX_ATTEMPTS = 3;

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  setNoStore(res);

  if (req.method !== "POST") {
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

  const body = typeof req.body === "object" ? req.body : {};
  const percent = safeNumber(body.percent);
  const correct = safeNumber(body.correct);
  const total = safeNumber(body.total);

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

    let attempts = 0;

    if (!rows.length) {
      attempts = 1;
      await db.insert(quizAttempts).values({
        telegramUserId,
        quizKey: QUIZ_KEY,
        attempts,
        lastPercent: percent,
        lastCorrect: correct,
        lastTotal: total,
        updatedAt: new Date(),
      });
    } else {
      attempts = (rows[0].attempts ?? 0) + 1;

      await db
        .update(quizAttempts)
        .set({
          attempts,
          lastPercent: percent,
          lastCorrect: correct,
          lastTotal: total,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quizAttempts.telegramUserId, telegramUserId),
            eq(quizAttempts.quizKey, QUIZ_KEY),
          ),
        );
    }

    const blocked = attempts >= MAX_ATTEMPTS;

    return res.status(200).json({
      telegramUserId,
      quizKey: QUIZ_KEY,
      attempts,
      maxAttempts: MAX_ATTEMPTS,
      blocked,
      saved: {
        percent,
        correct,
        total,
      },
    });
  } catch (e) {
    console.error("[api] /api/quiz/attempt error:", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
