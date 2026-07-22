import { randomUUID } from "node:crypto";
import {
  evaluateQuizCondition,
  mergeCategoryScores,
  scoreQuestionAnswer,
  selectQuizResult,
} from "./quizScoring.mjs";

function text(value, max = 20_000) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function normalizeOption(option, index) {
  return {
    id: text(option?.id || randomUUID(), 100),
    text: text(option?.text, 5_000),
    description: text(option?.description, 10_000),
    imageUrl: text(option?.imageUrl, 2_000) || null,
    isCorrect: Boolean(option?.isCorrect),
    score: finiteNumber(option?.score, 0),
    categoryScores:
      option?.categoryScores && typeof option.categoryScores === "object"
        ? clone(option.categoryScores)
        : {},
    nextQuestionId: text(option?.nextQuestionId, 100) || null,
    explanation: text(option?.explanation, 10_000),
    position: index,
  };
}

function normalizeQuestion(question, index) {
  return {
    id: text(question?.id || randomUUID(), 100),
    type: text(question?.type || "single_choice", 50),
    title: text(question?.title, 1_000),
    description: text(question?.description, 20_000),
    additionalDescription: text(question?.additionalDescription, 20_000),
    media: Array.isArray(question?.media)
      ? clone(question.media).slice(0, 20)
      : [],
    explanation: text(question?.explanation, 20_000),
    externalUrl: text(question?.externalUrl, 2_000) || null,
    isRequired: question?.isRequired !== false,
    score: finiteNumber(question?.score, 0),
    settings:
      question?.settings && typeof question.settings === "object"
        ? clone(question.settings)
        : {},
    defaultNextQuestionId: text(question?.defaultNextQuestionId, 100) || null,
    options: (Array.isArray(question?.options) ? question.options : []).map(
      normalizeOption,
    ),
    position: index,
  };
}

function normalizeResult(result, index) {
  return {
    id: text(result?.id || randomUUID(), 100),
    title: text(result?.title, 1_000),
    shortDescription: text(result?.shortDescription, 5_000),
    description: text(result?.description, 20_000),
    imageUrl: text(result?.imageUrl, 2_000) || null,
    conditions:
      result?.conditions && typeof result.conditions === "object"
        ? clone(result.conditions)
        : null,
    recommendations: text(result?.recommendations, 20_000),
    actionUrl: text(result?.actionUrl, 2_000) || null,
    actionLabel: text(result?.actionLabel, 200),
    priority: Math.trunc(finiteNumber(result?.priority, 0)),
    isDefault: Boolean(result?.isDefault),
    position: index,
  };
}

function normalizeLayout(layout) {
  if (
    !layout?.nodes ||
    typeof layout.nodes !== "object" ||
    Array.isArray(layout.nodes)
  )
    return null;
  const nodes = {};
  Object.entries(layout.nodes)
    .slice(0, 1_000)
    .forEach(([rawId, point]) => {
      const id = text(rawId, 100);
      const x = finiteNumber(point?.x);
      const y = finiteNumber(point?.y);
      if (id && x !== null && y !== null) nodes[id] = { x, y };
    });
  return { nodes };
}

export function prepareQuizDraft(input = {}, actor = {}) {
  const versionInput =
    input.version && typeof input.version === "object" ? input.version : {};
  const questions = (
    Array.isArray(versionInput.questions) ? versionInput.questions : []
  ).map(normalizeQuestion);
  const results = (
    Array.isArray(versionInput.results) ? versionInput.results : []
  ).map(normalizeResult);
  const layout = normalizeLayout(versionInput.layout);
  return {
    id: finiteNumber(input.id),
    authorId: finiteNumber(actor.id),
    title: text(input.title, 300),
    shortDescription: text(input.shortDescription, 1_000),
    description: text(input.description, 20_000),
    coverUrl: text(input.coverUrl, 2_000) || null,
    categoryId: finiteNumber(input.categoryId),
    tags: Array.from(
      new Set(
        (Array.isArray(input.tags) ? input.tags : [])
          .map((tag) => text(tag, 60))
          .filter(Boolean),
      ),
    ).slice(0, 20),
    ageRestriction: finiteNumber(input.ageRestriction),
    language: text(input.language || "ru", 20),
    estimatedMinutes: finiteNumber(input.estimatedMinutes),
    status: "draft",
    visibility: text(input.visibility || "registered", 30),
    attemptLimitType: text(input.attemptLimitType || "unlimited", 30),
    attemptLimit: finiteNumber(input.attemptLimit),
    availableFrom: input.availableFrom || null,
    availableUntil: input.availableUntil || null,
    participantLimit: finiteNumber(input.participantLimit),
    hideAfterParticipantLimit: Boolean(input.hideAfterParticipantLimit),
    settings:
      input.settings && typeof input.settings === "object"
        ? clone(input.settings)
        : {},
    accessRoleKeys: Array.from(
      new Set(
        (input.accessRoleKeys || [])
          .map((role) => text(role, 50))
          .filter(Boolean),
      ),
    ),
    accessUserIds: Array.from(
      new Set(
        (input.accessUserIds || [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ),
    version: {
      startQuestionId:
        text(versionInput.startQuestionId || questions[0]?.id, 100) || null,
      settings:
        versionInput.settings && typeof versionInput.settings === "object"
          ? clone(versionInput.settings)
          : {},
      questions,
      results,
      ...(layout ? { layout } : {}),
    },
  };
}

export function mergeQuizVersionPatch(existing = {}, incoming) {
  if (!incoming || typeof incoming !== "object") return clone(existing || {});
  return {
    ...clone(existing || {}),
    ...clone(incoming),
    settings: {
      ...(existing?.settings && typeof existing.settings === "object"
        ? clone(existing.settings)
        : {}),
      ...(incoming?.settings && typeof incoming.settings === "object"
        ? clone(incoming.settings)
        : {}),
    },
    layout:
      incoming.layout === undefined
        ? clone(existing?.layout)
        : clone(incoming.layout),
  };
}

export function buildPublishedQuizSnapshot(draft, versionNumber = 1) {
  const version = clone(draft.version || {});
  return deepFreeze({
    quizId: draft.id || null,
    versionNumber: Math.max(1, Math.trunc(Number(versionNumber) || 1)),
    title: draft.title,
    description: draft.description,
    coverUrl: draft.coverUrl,
    settings: clone(draft.settings || {}),
    attemptLimitType: draft.attemptLimitType,
    attemptLimit: draft.attemptLimit,
    startQuestionId: version.startQuestionId,
    versionSettings: version.settings || {},
    questions: version.questions || [],
    results: version.results || [],
  });
}

export function sanitizeQuizQuestionForParticipant(source = {}) {
  const question = clone(source || {});
  delete question.scoring;
  delete question.defaultNextQuestionId;
  if (question.settings && typeof question.settings === "object") {
    delete question.settings.correctText;
    delete question.settings.acceptedAnswers;
    delete question.settings.acceptedValues;
    delete question.settings.branches;
  }
  question.options = (
    Array.isArray(question.options) ? question.options : []
  ).map((option) => {
    delete option.isCorrect;
    delete option.score;
    delete option.scoreCategoryId;
    delete option.nextQuestionId;
    return option;
  });
  return question;
}

export function sanitizeQuizResultForParticipant(source = {}) {
  const result = clone(source || {});
  delete result.conditions;
  delete result.priority;
  delete result.isDefault;
  return result;
}

export function sanitizeQuizVersionForParticipant(version = {}) {
  const sanitized = clone(version || {});
  sanitized.results = [];
  sanitized.questions = (
    Array.isArray(sanitized.questions) ? sanitized.questions : []
  ).map(sanitizeQuizQuestionForParticipant);
  return sanitized;
}

function resolveNextTarget(question, answer, context) {
  const selectedIds = new Set((answer?.selectedOptionIds || []).map(String));
  const selected = (question.options || []).find(
    (option) => selectedIds.has(String(option.id)) && option.nextQuestionId,
  );
  if (selected?.nextQuestionId) return selected.nextQuestionId;
  const branch = (question?.settings?.branches || [])
    .sort(
      (left, right) => Number(right.priority || 0) - Number(left.priority || 0),
    )
    .find((item) => evaluateQuizCondition(item.condition, context));
  return branch?.targetId || question.defaultNextQuestionId || null;
}

export function advanceQuizAttempt(
  currentState = {},
  snapshot,
  questionId,
  answer = {},
) {
  const question = snapshot.questions.find(
    (item) => String(item.id) === String(questionId),
  );
  if (!question) throw new Error("quiz_question_not_found");
  const scored = scoreQuestionAnswer(question, answer);
  const state = {
    score: Number(currentState.score || 0) + scored.score,
    categoryScores: mergeCategoryScores(
      { ...(currentState.categoryScores || {}) },
      scored.categoryScores,
    ),
    correctCount:
      Number(currentState.correctCount || 0) +
      (scored.isCorrect === true ? 1 : 0),
    incorrectCount:
      Number(currentState.incorrectCount || 0) +
      (scored.isCorrect === false ? 1 : 0),
    skippedCount: Number(currentState.skippedCount || 0),
    answers: { ...(currentState.answers || {}), [question.id]: clone(answer) },
  };
  const context = { ...state, roles: currentState.roles || [] };
  const target = resolveNextTarget(question, answer, context);
  let result = null;
  if (target?.startsWith("result:"))
    result =
      snapshot.results.find((item) => String(item.id) === target.slice(7)) ||
      null;
  if (target === "complete" || (!target && question.type !== "information"))
    result = selectQuizResult(snapshot.results, context);
  if (result)
    return { completed: true, nextQuestionId: null, result, scored, state };
  if (!target) throw new Error("quiz_branch_dead_end");
  if (!snapshot.questions.some((item) => String(item.id) === String(target)))
    throw new Error("quiz_transition_target_missing");
  return {
    completed: false,
    nextQuestionId: target,
    result: null,
    scored,
    state,
  };
}
