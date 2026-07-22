import test from "node:test";
import assert from "node:assert/strict";

import { evaluateAttemptEligibility } from "../lib/quizAttemptPolicy.mjs";

const now = new Date("2026-07-22T12:00:00.000Z");

test("fixed attempt limit blocks after completed attempts", () => {
  const result = evaluateAttemptEligibility({
    quiz: { attemptLimitType: "fixed", attemptLimit: 2, settings: {} },
    attempts: [{ status: "completed" }, { status: "completed" }],
    now,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "attempt_limit_reached");
});

test("unfinished attempt is reusable and does not consume by default", () => {
  const result = evaluateAttemptEligibility({
    quiz: {
      attemptLimitType: "one",
      settings: { incompleteAttemptCounts: false, allowResume: true },
    },
    attempts: [
      { id: 44, status: "in_progress", startedAt: "2026-07-22T11:00:00.000Z" },
    ],
    now,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.resumeAttemptId, 44);
});

test("daily limit allows a new attempt on the next UTC day", () => {
  const result = evaluateAttemptEligibility({
    quiz: { attemptLimitType: "daily", settings: {} },
    attempts: [
      { status: "completed", completedAt: "2026-07-21T23:00:00.000Z" },
    ],
    now,
  });
  assert.equal(result.allowed, true);
});

test("administrator denial and extra attempts override normal count", () => {
  const denied = evaluateAttemptEligibility({
    quiz: { attemptLimitType: "unlimited", settings: {} },
    attempts: [],
    adjustments: [{ type: "deny", active: true }],
    now,
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "attempts_denied");

  const extra = evaluateAttemptEligibility({
    quiz: { attemptLimitType: "one", settings: {} },
    attempts: [{ status: "completed" }],
    adjustments: [{ type: "add", amount: 1 }],
    now,
  });
  assert.equal(extra.allowed, true);
});
