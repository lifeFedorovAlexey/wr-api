import test from "node:test";
import assert from "node:assert/strict";

import {
  prepareQuizDraft,
  buildPublishedQuizSnapshot,
  advanceQuizAttempt,
  sanitizeQuizVersionForParticipant,
  sanitizeQuizResultForParticipant,
  mergeQuizVersionPatch,
} from "../lib/quizDomain.mjs";

const draftInput = {
  title: "  Матчапы топа  ",
  description: "Проверка знаний",
  authorId: 999,
  attemptLimitType: "fixed",
  attemptLimit: 3,
  version: {
    startQuestionId: "q1",
    settings: { showScore: true },
    questions: [
      {
        id: "q1",
        type: "single_choice",
        title: "Кого выбрать?",
        score: 1,
        options: [
          {
            id: "a",
            text: "Вейн",
            isCorrect: true,
            score: 1,
            nextQuestionId: "result:win",
          },
          {
            id: "b",
            text: "Гарен",
            isCorrect: false,
            score: 0,
            nextQuestionId: "result:lose",
          },
        ],
      },
    ],
    results: [
      {
        id: "win",
        title: "Эксперт",
        isDefault: false,
        priority: 10,
        conditions: { op: "score_gte", value: 1 },
      },
      { id: "lose", title: "Новичок", isDefault: true, priority: 0 },
    ],
  },
};

test("prepareQuizDraft uses authenticated author and normalizes content", () => {
  const draft = prepareQuizDraft(draftInput, { id: 7 });
  assert.equal(draft.authorId, 7);
  assert.equal(draft.title, "Матчапы топа");
  assert.equal(draft.status, "draft");
  assert.equal(draft.version.questions[0].position, 0);
});

test("prepareQuizDraft preserves editor node positions", () => {
  const draft = prepareQuizDraft(
    {
      ...draftInput,
      version: {
        ...draftInput.version,
        layout: {
          nodes: {
            start: { x: 410, y: 34 },
            q1: { x: 123.5, y: 456.25 },
            "result:win": { x: 700, y: 456.25 },
          },
        },
      },
    },
    { id: 7 },
  );

  assert.deepEqual(draft.version.layout, {
    nodes: {
      start: { x: 410, y: 34 },
      q1: { x: 123.5, y: 456.25 },
      "result:win": { x: 700, y: 456.25 },
    },
  });
});

test("published snapshot is a detached immutable version", () => {
  const draft = prepareQuizDraft(draftInput, { id: 7 });
  const snapshot = buildPublishedQuizSnapshot(draft, 2);
  draft.version.questions[0].title = "Изменено";
  assert.equal(snapshot.versionNumber, 2);
  assert.equal(snapshot.questions[0].title, "Кого выбрать?");
  assert.equal(Object.isFrozen(snapshot), true);
});

test("attempt advancement returns selected terminal result and score", () => {
  const snapshot = buildPublishedQuizSnapshot(
    prepareQuizDraft(draftInput, { id: 7 }),
    1,
  );
  const next = advanceQuizAttempt(
    {
      score: 0,
      categoryScores: {},
      correctCount: 0,
      incorrectCount: 0,
      answers: {},
    },
    snapshot,
    "q1",
    { selectedOptionIds: ["a"] },
  );
  assert.equal(next.completed, true);
  assert.equal(next.result.id, "win");
  assert.equal(next.state.score, 1);
  assert.equal(next.state.correctCount, 1);
});

test("participant payload does not disclose answer keys or result rules", () => {
  const version = {
    questions: [
      {
        id: "q1",
        type: "single_choice",
        title: "Question",
        scoring: { correctScore: 5 },
        settings: { correctText: "secret", acceptedAnswers: ["hidden"] },
        options: [
          {
            id: "a",
            text: "A",
            isCorrect: true,
            score: 5,
            scoreCategoryId: "skill",
          },
        ],
      },
    ],
    results: [
      {
        id: "r1",
        title: "Secret",
        conditions: [{ type: "score", min: 5 }],
      },
    ],
  };
  const publicVersion = sanitizeQuizVersionForParticipant(version);
  assert.equal(publicVersion.questions[0].options[0].isCorrect, undefined);
  assert.equal(publicVersion.questions[0].options[0].score, undefined);
  assert.equal(publicVersion.questions[0].settings.correctText, undefined);
  assert.equal(publicVersion.questions[0].scoring, undefined);
  assert.deepEqual(publicVersion.results, []);
  const publicResult = sanitizeQuizResultForParticipant(version.results[0]);
  assert.equal(publicResult.conditions, undefined);
  assert.equal(publicResult.title, "Secret");
});

test("metadata-only version patch preserves existing quiz content", () => {
  const existing = {
    startQuestionId: "q1",
    questions: [{ id: "q1", title: "Kept" }],
    results: [{ id: "r1" }],
    settings: { showScore: true, theme: "dark" },
    layout: { nodes: { q1: { x: 10, y: 20 } } },
  };
  const unchanged = mergeQuizVersionPatch(existing, undefined);
  assert.deepEqual(unchanged, existing);
  const patched = mergeQuizVersionPatch(existing, {
    settings: { showScore: false },
  });
  assert.deepEqual(patched.questions, existing.questions);
  assert.deepEqual(patched.results, existing.results);
  assert.equal(patched.settings.showScore, false);
  assert.equal(patched.settings.theme, "dark");
  assert.deepEqual(patched.layout, existing.layout);
});
