import test from "node:test";
import assert from "node:assert/strict";

import * as schema from "../db/schema.js";

const REQUIRED_TABLES = [
  "quizzes",
  "quizVersions",
  "quizQuestions",
  "quizAnswerOptions",
  "quizResults",
  "quizAttempts",
  "quizAttemptAnswers",
  "quizTransitions",
  "quizAuditLog",
  "quizAccessUsers",
  "quizAccessRoles",
  "quizAttemptAdjustments",
  "quizReports",
];

test("canonical quiz schema exports every required entity", () => {
  for (const name of REQUIRED_TABLES) {
    assert.ok(schema[name], `missing schema export ${name}`);
  }
});

test("legacy Telegram quiz schema is not imported by canonical schema", () => {
  assert.equal("telegramUserId" in (schema.quizAttempts || {}), false);
});
