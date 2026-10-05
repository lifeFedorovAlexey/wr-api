import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  quizAttemptAdjustments,
  quizAttemptAnswers,
  quizAttempts,
  quizTransitions,
} from "../db/schema.js";
import {
  advanceQuizAttempt,
  sanitizeQuizResultForParticipant,
} from "./quizDomain.mjs";
import { validateAndNormalizeAnswer } from "./quizAnswerValidation.mjs";
import { evaluateAttemptEligibility } from "./quizAttemptPolicy.mjs";

import {
  appError,
  canUserAccessQuiz,
  getQuizSnapshotForAttempt,
  loadVersion,
} from "./quizzes.mjs";

function parseId(value, code = "attempt_id_invalid") {
  const id = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(id) || id <= 0) throw appError(code, 400);
  return id;
}

function publicQuestion(question) {
  if (!question) return null;
  return {
    id: question.id,
    type: question.type,
    title: question.title,
    description: question.description,
    additionalDescription: question.additionalDescription,
    media: question.media,
    isRequired: question.isRequired,
    settings: {
      minSelected: question.settings?.minSelected,
      maxSelected: question.settings?.maxSelected,
      min: question.settings?.min,
      max: question.settings?.max,
      step: question.settings?.step,
      minLabel: question.settings?.minLabel,
      maxLabel: question.settings?.maxLabel,
      unit: question.settings?.unit,
    },
    options: (question.options || []).map((option) => ({
      id: option.id,
      text: option.text,
      description: option.description,
      imageUrl: option.imageUrl,
    })),
  };
}

function findAttemptQuestion(attempt, snapshot) {
  return snapshot?.questions?.find(
    (item) => String(item.id) === String(attempt.currentQuestionKey),
  );
}

function findAttemptResult(attempt, snapshot, includeResult) {
  if (!includeResult) return null;
  return snapshot?.results?.find(
    (item) => String(item.id) === String(attempt.resultKey),
  );
}

function buildAttemptProgress(attempt, snapshot) {
  const total = snapshot?.questions?.length || null;
  const answered = attempt.visitedQuestionKeys?.length || 0;
  return {
    answered,
    total,
    percent: total ? Math.min(100, Math.round((answered / total) * 100)) : null,
  };
}

function toIsoOrValue(value) {
  return value?.toISOString?.() || value;
}

function buildAttemptResult(attempt, snapshot, includeResult) {
  const result = findAttemptResult(attempt, snapshot, includeResult);
  return {
    score: includeResult ? attempt.score : undefined,
    categoryScores: includeResult ? attempt.categoryScores : undefined,
    correctCount: includeResult ? attempt.correctCount : undefined,
    incorrectCount: includeResult ? attempt.incorrectCount : undefined,
    skippedCount: includeResult ? attempt.skippedCount : undefined,
    result: result ? sanitizeQuizResultForParticipant(result) : null,
  };
}

function attemptView(attempt, snapshot, { includeResult = false } = {}) {
  return {
    id: attempt.id,
    quizId: attempt.quizId,
    quizVersionId: attempt.quizVersionId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    question: publicQuestion(findAttemptQuestion(attempt, snapshot)),
    currentQuestionId: attempt.currentQuestionKey,
    progress: buildAttemptProgress(attempt, snapshot),
    ...buildAttemptResult(attempt, snapshot, includeResult),
    startedAt: toIsoOrValue(attempt.startedAt),
    completedAt: toIsoOrValue(attempt.completedAt),
    lastActivityAt: toIsoOrValue(attempt.lastActivityAt),
    durationSeconds: attempt.durationSeconds,
  };
}

async function loadAttempt(attemptId, executor = db) {
  const [attempt] = await executor
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.id, parseId(attemptId)))
    .limit(1);
  if (!attempt) throw appError("quiz_attempt_not_found", 404);
  return attempt;
}

async function loadSnapshotForAttempt(attempt, executor = db) {
  const version = await loadVersion(attempt.quizVersionId, executor);
  const snapshot = version?.settings?.snapshot;
  if (!snapshot) throw appError("quiz_attempt_version_missing", 409);
  return snapshot;
}

function requireAttemptOwner(actor, attempt) {
  if (!actor?.id) throw appError("unauthorized", 401);
  if (
    Number(actor.id) !== Number(attempt.userId) &&
    !(actor.roles || []).some((role) => role === "admin" || role === "owner")
  ) {
    throw appError("forbidden", 403);
  }
}

export async function startQuizAttempt(actor, quizId) {
  if (!actor?.id) throw appError("unauthorized", 401);
  const id = parseId(quizId, "quiz_id_invalid");
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${id}, ${Number(actor.id)})`,
    );
    const { quiz, version, snapshot } = await getQuizSnapshotForAttempt(id, tx);
    if (!(await canUserAccessQuiz(actor, quiz, { allowDirectLink: true })))
      throw appError("quiz_not_available", 403);
    if (quiz.status !== "published") throw appError("quiz_not_available", 409);
    const attempts = await tx
      .select()
      .from(quizAttempts)
      .where(
        and(eq(quizAttempts.quizId, id), eq(quizAttempts.userId, actor.id)),
      )
      .orderBy(desc(quizAttempts.attemptNumber));
    const adjustments = await tx
      .select()
      .from(quizAttemptAdjustments)
      .where(
        and(
          eq(quizAttemptAdjustments.quizId, id),
          eq(quizAttemptAdjustments.userId, actor.id),
        ),
      );
    const eligibility = evaluateAttemptEligibility({
      quiz,
      attempts,
      adjustments,
    });
    if (eligibility.resumeAttemptId) {
      const existing = attempts.find(
        (item) => item.id === eligibility.resumeAttemptId,
      );
      return {
        resumed: true,
        eligibility,
        attempt: attemptView(existing, snapshot),
      };
    }
    if (!eligibility.allowed)
      throw appError(eligibility.reason, 409, eligibility);
    const attemptNumber =
      Math.max(0, ...attempts.map((item) => Number(item.attemptNumber || 0))) +
      1;
    const [attempt] = await tx
      .insert(quizAttempts)
      .values({
        quizId: id,
        quizVersionId: version.id,
        userId: actor.id,
        attemptNumber,
        status: "in_progress",
        currentQuestionKey: snapshot.startQuestionId,
        visitedQuestionKeys: [],
      })
      .returning();
    return {
      resumed: false,
      eligibility,
      attempt: attemptView(attempt, snapshot),
    };
  });
}

export async function getQuizAttempt(actor, attemptId) {
  const attempt = await loadAttempt(attemptId);
  requireAttemptOwner(actor, attempt);
  const snapshot = await loadSnapshotForAttempt(attempt);
  return attemptView(attempt, snapshot, {
    includeResult: attempt.status === "completed",
  });
}

async function findDuplicateAnswer(tx, attemptId, requestId) {
  const [duplicate] = await tx
    .select()
    .from(quizAttemptAnswers)
    .where(
      and(
        eq(quizAttemptAnswers.attemptId, attemptId),
        eq(quizAttemptAnswers.requestId, requestId),
      ),
    )
    .limit(1);
  return duplicate;
}

async function loadSubmitContext(tx, actor, attemptId, requestId) {
  await tx.execute(sql`select pg_advisory_xact_lock(${parseId(attemptId)})`);
  const attempt = await loadAttempt(attemptId, tx);
  requireAttemptOwner(actor, attempt);
  const duplicate = await findDuplicateAnswer(tx, attempt.id, requestId);
  const snapshot = await loadSnapshotForAttempt(attempt, tx);
  return { attempt, duplicate, snapshot };
}

function validateQuestionKey(attempt, input) {
  if (attempt.status !== "in_progress")
    throw appError("quiz_attempt_not_active", 409);
  const questionKey = String(input.questionId || "");
  if (!questionKey || questionKey !== String(attempt.currentQuestionKey))
    throw appError("quiz_answer_wrong_question", 409);
  return questionKey;
}

async function ensureQuestionNotAnswered(tx, attemptId, questionKey) {
  const [alreadyAnswered] = await tx
    .select()
    .from(quizAttemptAnswers)
    .where(
      and(
        eq(quizAttemptAnswers.attemptId, attemptId),
        eq(quizAttemptAnswers.questionKey, questionKey),
      ),
    )
    .limit(1);
  if (alreadyAnswered) throw appError("quiz_question_already_answered", 409);
}

async function loadAttemptAnswerState(tx, attempt, actor) {
  const existingAnswers = await tx
    .select()
    .from(quizAttemptAnswers)
    .where(eq(quizAttemptAnswers.attemptId, attempt.id));
  return {
    score: attempt.score,
    categoryScores: attempt.categoryScores || {},
    correctCount: attempt.correctCount,
    incorrectCount: attempt.incorrectCount,
    skippedCount: attempt.skippedCount,
    answers: Object.fromEntries(
      existingAnswers.map((answer) => [
        answer.questionKey,
        {
          selectedOptionIds: answer.selectedOptionIds,
          textValue: answer.textValue,
          numberValue: answer.numberValue,
        },
      ]),
    ),
    roles: actor.roles || [],
  };
}

function findQuestion(snapshot, questionKey) {
  const question = (snapshot.questions || []).find(
    (item) => String(item.id) === questionKey,
  );
  if (!question) throw appError("quiz_question_not_found", 409);
  return question;
}

async function insertAttemptAnswer(tx, attempt, questionKey, requestId, answer, advanced) {
  await tx.insert(quizAttemptAnswers).values({
    attemptId: attempt.id,
    questionKey,
    requestId,
    selectedOptionIds: answer.selectedOptionIds,
    textValue: answer.textValue,
    numberValue: Number.isFinite(answer.numberValue)
      ? answer.numberValue
      : null,
    structuredValue: null,
    score: advanced.scored.score,
    categoryScores: advanced.scored.categoryScores,
    isCorrect: advanced.scored.isCorrect,
    requiresReview: advanced.scored.requiresReview,
  });
}

function buildAttemptUpdates(attempt, questionKey, advanced, now) {
  const updates = {
    currentQuestionKey: advanced.nextQuestionId,
    score: advanced.state.score,
    categoryScores: advanced.state.categoryScores,
    correctCount: advanced.state.correctCount,
    incorrectCount: advanced.state.incorrectCount,
    visitedQuestionKeys: [...(attempt.visitedQuestionKeys || []), questionKey],
    lastActivityAt: now,
    lockVersion: Number(attempt.lockVersion || 0) + 1,
  };
  if (!advanced.completed) return updates;
  updates.status = advanced.scored.requiresReview ? "pending_review" : "completed";
  updates.resultKey = advanced.result?.id || null;
  updates.completedAt = now;
  updates.durationSeconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(attempt.startedAt).getTime()) / 1000),
  );
  return updates;
}

async function updateAttempt(tx, attempt, updates) {
  const [updated] = await tx
    .update(quizAttempts)
    .set(updates)
    .where(eq(quizAttempts.id, attempt.id))
    .returning();
  return updated;
}

async function insertQuizTransition(tx, attempt, questionKey, requestId, answer, advanced) {
  await tx.insert(quizTransitions).values({
    attemptId: attempt.id,
    fromQuestionKey: questionKey,
    toQuestionKey: advanced.nextQuestionId,
    toResultKey: advanced.result?.id || null,
    trigger: { requestId, selectedOptionIds: answer.selectedOptionIds },
  });
}

export async function submitQuizAnswer(actor, attemptId, input = {}) {
  const requestId = String(input.requestId || randomUUID()).slice(0, 200);
  return await db.transaction(async (tx) => {
    const { attempt, duplicate, snapshot } = await loadSubmitContext(
      tx,
      actor,
      attemptId,
      requestId,
    );
    if (duplicate)
      return {
        idempotent: true,
        attempt: attemptView(attempt, snapshot, {
          includeResult: attempt.status === "completed",
        }),
      };

    const questionKey = validateQuestionKey(attempt, input);
    await ensureQuestionNotAnswered(tx, attempt.id, questionKey);
    const state = await loadAttemptAnswerState(tx, attempt, actor);
    const question = findQuestion(snapshot, questionKey);
    const answer = validateAndNormalizeAnswer(question, input);
    const advanced = advanceQuizAttempt(state, snapshot, questionKey, answer);
    await insertAttemptAnswer(tx, attempt, questionKey, requestId, answer, advanced);
    const updated = await updateAttempt(
      tx,
      attempt,
      buildAttemptUpdates(attempt, questionKey, advanced, new Date()),
    );
    await insertQuizTransition(
      tx,
      attempt,
      questionKey,
      requestId,
      answer,
      advanced,
    );
    return {
      idempotent: false,
      attempt: attemptView(updated, snapshot, {
        includeResult: updated.status === "completed",
      }),
      scored: advanced.scored,
    };
  });
}

export async function cancelQuizAttempt(actor, attemptId) {
  return await db.transaction(async (tx) => {
    const id = parseId(attemptId);
    await tx.execute(sql`select pg_advisory_xact_lock(${id})`);
    const attempt = await loadAttempt(id, tx);
    requireAttemptOwner(actor, attempt);
    if (attempt.status !== "in_progress")
      throw appError("quiz_attempt_not_active", 409);
    const [updated] = await tx
      .update(quizAttempts)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        lastActivityAt: new Date(),
      })
      .where(
        and(
          eq(quizAttempts.id, attempt.id),
          eq(quizAttempts.status, "in_progress"),
        ),
      )
      .returning();
    if (!updated) throw appError("quiz_attempt_not_active", 409);
    return { id: updated.id, status: updated.status };
  });
}

export async function listUserQuizAttempts(actor) {
  if (!actor?.id) throw appError("unauthorized", 401);
  const attempts = await db
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.userId, actor.id))
    .orderBy(desc(quizAttempts.lastActivityAt));
  const result = [];
  for (const attempt of attempts) {
    const snapshot = await loadSnapshotForAttempt(attempt);
    result.push({
      ...attemptView(attempt, snapshot, {
        includeResult: attempt.status === "completed",
      }),
      quizTitle: snapshot.title,
      quizCoverUrl: snapshot.coverUrl,
    });
  }
  return result;
}

export async function getQuizAttemptResult(actor, attemptId) {
  const attempt = await loadAttempt(attemptId);
  requireAttemptOwner(actor, attempt);
  if (attempt.status !== "completed")
    throw appError("quiz_result_not_ready", 409);
  const snapshot = await loadSnapshotForAttempt(attempt);
  return attemptView(attempt, snapshot, { includeResult: true });
}
