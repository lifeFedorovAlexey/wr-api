import test from "node:test";
import assert from "node:assert/strict";

import { scoreQuestionAnswer, selectQuizResult } from "../lib/quizScoring.mjs";

test("single choice returns option and category scores", () => {
  const question = {
    type: "single_choice",
    options: [
      { id: "a", isCorrect: true, score: 2, categoryScores: { knowledge: 3 } },
      { id: "b", isCorrect: false, score: -1 },
    ],
  };
  assert.deepEqual(
    scoreQuestionAnswer(question, { selectedOptionIds: ["a"] }),
    {
      score: 2,
      categoryScores: { knowledge: 3 },
      isCorrect: true,
      requiresReview: false,
    },
  );
});

test("multiple choice supports partial per-option scoring", () => {
  const question = {
    type: "multiple_choice",
    settings: { scoringMode: "per_option" },
    options: [
      { id: "a", isCorrect: true, score: 2 },
      { id: "b", isCorrect: true, score: 2 },
      { id: "c", isCorrect: false, score: -1 },
    ],
  };
  const result = scoreQuestionAnswer(question, {
    selectedOptionIds: ["a", "c"],
  });
  assert.equal(result.score, 1);
  assert.equal(result.isCorrect, false);
});

test("text answers support case-insensitive alternatives and manual review", () => {
  const automatic = scoreQuestionAnswer(
    {
      type: "text",
      settings: { mode: "allowed", allowedValues: ["Барон Нашор", "Барон"] },
      score: 1,
    },
    { textValue: "барон" },
  );
  assert.equal(automatic.isCorrect, true);
  assert.equal(automatic.score, 1);

  const manual = scoreQuestionAnswer(
    { type: "text", settings: { mode: "manual" }, score: 5 },
    { textValue: "Мой разбор" },
  );
  assert.equal(manual.requiresReview, true);
  assert.equal(manual.score, 0);
});

test("result selection respects priority and default fallback", () => {
  const results = [
    { id: "default", priority: 0, isDefault: true },
    { id: "high", priority: 20, conditions: { op: "score_gte", value: 8 } },
    { id: "mid", priority: 10, conditions: { op: "score_gte", value: 4 } },
  ];
  assert.equal(selectQuizResult(results, { score: 9 }).id, "high");
  assert.equal(selectQuizResult(results, { score: 1 }).id, "default");
});
