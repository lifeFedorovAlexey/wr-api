import {
  pgTable,
  serial,
  bigint,
  integer,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Таблица для хранения попыток прохождения квиза
 * 1 запись = 1 пользователь + 1 квиз
 */
export const quizAttempts = pgTable("quiz_attempts", {
  id: serial("id").primaryKey(),

  // Telegram user id (из initData)
  telegramUserId: bigint("telegram_user_id", {
    mode: "number",
  }).notNull(),

  // Ключ квиза (на будущее, если будет несколько квизов)
  quizKey: varchar("quiz_key", { length: 64 }).notNull().default("lol_quiz"),

  // Сколько раз пользователь доходил до Result
  attempts: integer("attempts").notNull().default(0),

  // Последний результат (нужно для reward API)
  lastPercent: integer("last_percent"),
  lastCorrect: integer("last_correct"),
  lastTotal: integer("last_total"),

  // Тайминги
  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});
