// api/quiz.js
import { db } from "../db/client.js";
import { quizAttempts } from "../db/schema_quiz.js";
import { setCors } from "./utils/cors.js";
import { eq, and } from "drizzle-orm";

/**
 * actions:
 * - status   GET  ?action=status&telegramUserId=123
 * - attempt  POST ?action=attempt
 * - reward   GET  ?action=reward&telegramUserId=123
 */

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = req.query.action;

  try {
    // =========================
    // STATUS
    // =========================
    if (action === "status" && req.method === "GET") {
      const telegramUserId = Number(req.query.telegramUserId);
      if (!telegramUserId) {
        return res.status(400).json({ error: "telegramUserId required" });
      }

      const row = await db
        .select()
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.telegramUserId, telegramUserId),
            eq(quizAttempts.quizKey, "lol_quiz"),
          ),
        )
        .limit(1);

      return res.status(200).json({
        attempts: row[0]?.attempts ?? 0,
        lastPercent: row[0]?.lastPercent ?? null,
        lastAt: row[0]?.updatedAt ?? null,
      });
    }

    // =========================
    // ATTEMPT
    // =========================
    if (action === "attempt" && req.method === "POST") {
      const { telegramUserId, correct, total, percent } = req.body || {};

      if (!telegramUserId) {
        return res.status(400).json({ error: "telegramUserId required" });
      }

      const existing = await db
        .select()
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.telegramUserId, telegramUserId),
            eq(quizAttempts.quizKey, "lol_quiz"),
          ),
        )
        .limit(1);

      if (!existing.length) {
        await db.insert(quizAttempts).values({
          telegramUserId,
          quizKey: "lol_quiz",
          attempts: 1,
          lastCorrect: correct,
          lastTotal: total,
          lastPercent: percent,
        });
      } else {
        await db
          .update(quizAttempts)
          .set({
            attempts: existing[0].attempts + 1,
            lastCorrect: correct,
            lastTotal: total,
            lastPercent: percent,
            updatedAt: new Date(),
          })
          .where(eq(quizAttempts.id, existing[0].id));
      }

      return res.status(200).json({ ok: true });
    }

    // =========================
    // REWARD
    // =========================
    if (action === "reward" && req.method === "GET") {
      const telegramUserId = Number(req.query.telegramUserId);
      if (!telegramUserId) {
        return res.status(400).json({ error: "telegramUserId required" });
      }

      const row = await db
        .select()
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.telegramUserId, telegramUserId),
            eq(quizAttempts.quizKey, "lol_quiz"),
          ),
        )
        .limit(1);

      const attempts = row[0]?.attempts ?? 0;
      const lastPercent = row[0]?.lastPercent ?? 0;

      if (lastPercent === 100 && attempts <= 2) {
        return res.status(200).json({
          allowed: true,
          link: process.env.TG_SECRET_CHAT_LINK,
        });
      }

      return res.status(200).json({
        allowed: false,
        reason: attempts > 2 ? "ATTEMPTS_LIMIT" : "NOT_100_PERCENT",
      });
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (e) {
    console.error("[quiz api error]", e);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
