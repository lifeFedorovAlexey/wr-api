import test from "node:test";
import assert from "node:assert/strict";

import { validateQuizDefinition } from "../lib/quizValidation.mjs";

function validQuiz() {
  return {
    title: "Знание верхней линии",
    description: "Проверь знание матчапов.",
    attemptLimitType: "fixed",
    attemptLimit: 3,
    version: {
      startQuestionId: "q1",
      settings: {},
      questions: [
        {
          id: "q1",
          type: "single_choice",
          title: "Кто силён против танков?",
          isRequired: true,
          defaultNextQuestionId: null,
          options: [
            {
              id: "a1",
              text: "Вейн",
              isCorrect: true,
              score: 1,
              nextQuestionId: "result:r1",
            },
            {
              id: "a2",
              text: "Гарен",
              isCorrect: false,
              score: 0,
              nextQuestionId: "result:r0",
            },
          ],
        },
      ],
      results: [
        {
          id: "r1",
          title: "Эксперт",
          priority: 10,
          isDefault: false,
          conditions: { op: "score_gte", value: 1 },
        },
        {
          id: "r0",
          title: "Новичок",
          priority: 0,
          isDefault: true,
          conditions: null,
        },
      ],
    },
  };
}

test("valid quiz definition passes publication validation", () => {
  const result = validateQuizDefinition(validQuiz());
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test("publication validation rejects missing default result and deleted targets", () => {
  const quiz = validQuiz();
  quiz.version.results = quiz.version.results.filter(
    (result) => !result.isDefault,
  );
  quiz.version.questions[0].options[0].nextQuestionId = "missing";
  const result = validateQuizDefinition(quiz);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.code === "default_result_required"),
  );
  assert.ok(
    result.errors.some((error) => error.code === "transition_target_missing"),
  );
});

test("publication validation rejects cycles without an exit", () => {
  const quiz = validQuiz();
  quiz.version.questions.push({
    id: "q2",
    type: "yes_no",
    title: "Вернуться?",
    isRequired: true,
    defaultNextQuestionId: "q1",
    options: [
      { id: "yes", text: "Да", score: 0, nextQuestionId: "q1" },
      { id: "no", text: "Нет", score: 0, nextQuestionId: "q1" },
    ],
  });
  quiz.version.questions[0].options.forEach((option) => {
    option.nextQuestionId = "q2";
  });
  const result = validateQuizDefinition(quiz);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "branch_cycle"));
});

test("publication validation rejects transient and local-only media URLs", () => {
  const quiz = validQuiz();
  quiz.coverUrl = "blob:http://localhost/transient";
  quiz.version.questions[0].media = [
    { url: "/uploads/quizzes/local-only.png" },
  ];
  quiz.version.questions[0].options[0].imageUrl =
    "blob:http://localhost/answer";
  quiz.version.results[0].imageUrl = "/uploads/quizzes/result.png";

  const result = validateQuizDefinition(quiz);
  assert.equal(result.valid, false);
  assert.equal(
    result.errors.filter((item) => item.code === "media_url_not_persistent")
      .length,
    4,
  );
});

test("publication validation fails closed for unfinished features", () => {
  const quiz = validQuiz();
  quiz.visibility = "typo_public";
  quiz.participantLimit = 10;
  quiz.version.questions[0].type = "sorting";
  quiz.version.questions[0].settings = { mode: "manual" };

  const result = validateQuizDefinition(quiz);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.code === "visibility_invalid"));
  assert.ok(
    result.errors.some(
      (item) => item.code === "participant_limit_not_supported",
    ),
  );
  assert.ok(
    result.errors.some((item) => item.code === "question_type_not_publishable"),
  );
});

test("manual review cannot be published until the review workflow exists", () => {
  const quiz = validQuiz();
  quiz.version.questions[0].type = "text";
  quiz.version.questions[0].options = [];
  quiz.version.questions[0].settings = { mode: "manual" };

  const result = validateQuizDefinition(quiz);
  assert.ok(
    result.errors.some((item) => item.code === "manual_review_not_supported"),
  );
});

test("published media must belong to the configured S3 public base", () => {
  const quiz = validQuiz();
  quiz.coverUrl = "https://external.example/tracker.png";
  const result = validateQuizDefinition(quiz, {
    publicMediaBaseUrl: "https://cdn.example/assets",
  });
  assert.ok(result.errors.some((item) => item.code === "media_url_not_s3"));

  quiz.coverUrl = "https://cdn.example/assets/quizzes/42/cover.png";
  const accepted = validateQuizDefinition(quiz, {
    publicMediaBaseUrl: "https://cdn.example/assets",
  });
  assert.equal(accepted.valid, true, JSON.stringify(accepted.errors));
});

test("information questions require an explicit transition", () => {
  const quiz = validQuiz();
  quiz.version.questions[0] = {
    id: "info",
    type: "information",
    title: "Правила",
    options: [],
  };
  quiz.version.startQuestionId = "info";
  const result = validateQuizDefinition(quiz);
  assert.ok(result.errors.some((item) => item.code === "branch_dead_end"));
});
