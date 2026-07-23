import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  quizAccessRoles,
  quizAccessUsers,
  quizAttempts,
  quizAuditLog,
  quizzes,
  quizVersions,
} from "../db/schema.js";
import {
  buildPublishedQuizSnapshot,
  mergeQuizVersionPatch,
  prepareQuizDraft,
} from "./quizDomain.mjs";
import {
  canManageQuiz,
  hasQuizCapability,
  QUIZ_CAPABILITIES,
  requireQuizCapability,
  requireQuizManagement,
} from "./quizPermissions.mjs";
import { isQuizPlayable } from "./quizAvailability.mjs";
import { validateQuizDefinition } from "./quizValidation.mjs";

function appError(code, statusCode = 400, details = null) {
  return Object.assign(new Error(code), { statusCode, details });
}

function assertQuizPlayable(row) {
  if (!isQuizPlayable(row)) {
    throw appError("quiz_not_available", 409);
  }
}

function parseId(value, code = "quiz_id_invalid") {
  const id = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(id) || id <= 0) throw appError(code, 400);
  return id;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toQuizView(row, { includeDefinition = false, version = null } = {}) {
  if (!row) return null;
  const payload = {
    id: row.id,
    authorId: row.authorId,
    title: row.title,
    shortDescription: row.shortDescription || "",
    description: row.description || "",
    coverUrl: row.coverUrl || null,
    categoryId: row.categoryId || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    ageRestriction: row.ageRestriction ?? null,
    language: row.language || "ru",
    estimatedMinutes: row.estimatedMinutes ?? null,
    status: row.status,
    visibility: row.visibility,
    attemptLimitType: row.attemptLimitType,
    attemptLimit: row.attemptLimit ?? null,
    availableFrom: toIso(row.availableFrom),
    availableUntil: toIso(row.availableUntil),
    participantLimit: row.participantLimit ?? null,
    hideAfterParticipantLimit: Boolean(row.hideAfterParticipantLimit),
    settings: row.settings || {},
    currentVersionId: row.currentVersionId || null,
    draftVersionId: row.draftVersionId || null,
    blockedReason: row.blockedReason || null,
    publishedAt: toIso(row.publishedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
  if (version) {
    payload.version = {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      settings: version.settings || {},
      publishedAt: toIso(version.publishedAt),
    };
    if (includeDefinition)
      payload.version.definition = version.settings?.definition || null;
  }
  return payload;
}

async function loadQuizRow(quizId, executor = db) {
  const [row] = await executor
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, parseId(quizId)), isNull(quizzes.deletedAt)))
    .limit(1);
  if (!row) throw appError("quiz_not_found", 404);
  return row;
}

async function loadVersion(versionId, executor = db) {
  if (!versionId) return null;
  const [row] = await executor
    .select()
    .from(quizVersions)
    .where(eq(quizVersions.id, Number(versionId)))
    .limit(1);
  return row || null;
}

async function audit(
  executor,
  quizId,
  actorUserId,
  action,
  metadata = {},
  quizVersionId = null,
) {
  await executor.insert(quizAuditLog).values({
    quizId,
    actorUserId: actorUserId || null,
    action,
    metadata,
    quizVersionId,
  });
}

async function replaceAccess(executor, quizId, draft) {
  await executor
    .delete(quizAccessRoles)
    .where(eq(quizAccessRoles.quizId, quizId));
  await executor
    .delete(quizAccessUsers)
    .where(eq(quizAccessUsers.quizId, quizId));
  if (draft.accessRoleKeys.length) {
    await executor
      .insert(quizAccessRoles)
      .values(draft.accessRoleKeys.map((roleKey) => ({ quizId, roleKey })));
  }
  if (draft.accessUserIds.length) {
    await executor
      .insert(quizAccessUsers)
      .values(draft.accessUserIds.map((userId) => ({ quizId, userId })));
  }
}

async function canUserAccessQuiz(user, row, { allowDirectLink = false } = {}) {
  if (canManageQuiz(user, row)) return true;
  if (!user?.id || row.status !== "published" || !row.currentVersionId)
    return false;
  if (
    ![
      "registered",
      "direct_link",
      "restricted_users",
      "restricted_roles",
    ].includes(row.visibility)
  )
    return false;
  const now = Date.now();
  if (row.availableFrom && new Date(row.availableFrom).getTime() > now)
    return false;
  if (row.availableUntil && new Date(row.availableUntil).getTime() < now)
    return false;
  if (row.visibility === "direct_link" && !allowDirectLink) return false;
  if (row.visibility === "restricted_users") {
    const [access] = await db
      .select()
      .from(quizAccessUsers)
      .where(
        and(
          eq(quizAccessUsers.quizId, row.id),
          eq(quizAccessUsers.userId, user.id),
        ),
      )
      .limit(1);
    if (!access) return false;
  }
  if (row.visibility === "restricted_roles") {
    const roles = (user.roles || []).map(String);
    if (!roles.length) return false;
    const access = await db
      .select()
      .from(quizAccessRoles)
      .where(
        and(
          eq(quizAccessRoles.quizId, row.id),
          inArray(quizAccessRoles.roleKey, roles),
        ),
      )
      .limit(1);
    if (!access.length) return false;
  }
  return true;
}

export async function createQuiz(actor, input = {}) {
  requireQuizCapability(actor, QUIZ_CAPABILITIES.CREATE);
  const draft = prepareQuizDraft(input, actor);
  return await db.transaction(async (tx) => {
    const [quiz] = await tx
      .insert(quizzes)
      .values({
        authorId: actor.id,
        title: draft.title || "",
        shortDescription: draft.shortDescription || null,
        description: draft.description || "",
        coverUrl: draft.coverUrl,
        categoryId: draft.categoryId,
        tags: draft.tags,
        ageRestriction: draft.ageRestriction,
        language: draft.language,
        estimatedMinutes: draft.estimatedMinutes,
        status: "draft",
        visibility: draft.visibility,
        attemptLimitType: draft.attemptLimitType,
        attemptLimit: draft.attemptLimit,
        availableFrom: draft.availableFrom
          ? new Date(draft.availableFrom)
          : null,
        availableUntil: draft.availableUntil
          ? new Date(draft.availableUntil)
          : null,
        participantLimit: draft.participantLimit,
        hideAfterParticipantLimit: draft.hideAfterParticipantLimit,
        settings: draft.settings,
      })
      .returning();
    draft.id = quiz.id;
    const [version] = await tx
      .insert(quizVersions)
      .values({
        quizId: quiz.id,
        versionNumber: 1,
        status: "draft",
        settings: { ...draft.version.settings, definition: draft.version },
        createdByUserId: actor.id,
      })
      .returning();
    await tx
      .update(quizzes)
      .set({ draftVersionId: version.id, updatedAt: new Date() })
      .where(eq(quizzes.id, quiz.id));
    await replaceAccess(tx, quiz.id, draft);
    await audit(tx, quiz.id, actor.id, "quiz.created", {}, version.id);
    return toQuizView(
      { ...quiz, draftVersionId: version.id },
      { includeDefinition: true, version },
    );
  });
}

export async function listQuizzes(actor, { managed = false } = {}) {
  if (!actor?.id) throw appError("unauthorized", 401);
  const rows = await db
    .select()
    .from(quizzes)
    .where(isNull(quizzes.deletedAt))
    .orderBy(desc(quizzes.updatedAt));
  const result = [];
  for (const row of rows) {
    if (
      managed ? canManageQuiz(actor, row) : await canUserAccessQuiz(actor, row)
    )
      result.push(toQuizView(row));
  }
  return result;
}

export async function getQuiz(
  actor,
  quizId,
  { manage = false, allowDirectLink = true } = {},
) {
  const row = await loadQuizRow(quizId);
  if (manage) requireQuizManagement(actor, row);
  else if (!(await canUserAccessQuiz(actor, row, { allowDirectLink })))
    throw appError("quiz_not_found", 404);
  const versionId =
    manage && row.draftVersionId ? row.draftVersionId : row.currentVersionId;
  const version = await loadVersion(versionId);
  return toQuizView(row, { includeDefinition: manage, version });
}

export async function updateQuiz(actor, quizId, input = {}) {
  const row = await loadQuizRow(quizId);
  requireQuizManagement(actor, row);
  if (
    (actor.roles || []).includes("patron") &&
    row.status === "published" &&
    !hasQuizCapability(actor, QUIZ_CAPABILITIES.MANAGE_ANY)
  ) {
    throw appError("patron_cannot_edit_published_quiz", 403);
  }
  return await db.transaction(async (tx) => {
    let version = await loadVersion(row.draftVersionId, tx);
    const current = version || (await loadVersion(row.currentVersionId, tx));
    const draft = prepareQuizDraft(
      {
        ...toQuizView(row),
        ...input,
        id: row.id,
        version: mergeQuizVersionPatch(
          current?.settings?.definition || {},
          input.version,
        ),
      },
      { id: row.authorId },
    );
    if (!version) {
      const [created] = await tx
        .insert(quizVersions)
        .values({
          quizId: row.id,
          versionNumber: Number(current?.versionNumber || 0) + 1,
          status: "draft",
          settings: {
            ...(draft.version.settings || {}),
            definition: draft.version,
          },
          createdByUserId: actor.id,
        })
        .returning();
      version = created;
    } else {
      [version] = await tx
        .update(quizVersions)
        .set({
          settings: {
            ...(draft.version.settings || {}),
            definition: draft.version,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(quizVersions.id, version.id),
            eq(quizVersions.status, "draft"),
          ),
        )
        .returning();
      if (!version) throw appError("published_version_immutable", 409);
    }
    const [updated] = await tx
      .update(quizzes)
      .set({
        title: draft.title,
        shortDescription: draft.shortDescription || null,
        description: draft.description,
        coverUrl: draft.coverUrl,
        categoryId: draft.categoryId,
        tags: draft.tags,
        ageRestriction: draft.ageRestriction,
        language: draft.language,
        estimatedMinutes: draft.estimatedMinutes,
        visibility: draft.visibility,
        attemptLimitType: draft.attemptLimitType,
        attemptLimit: draft.attemptLimit,
        availableFrom: draft.availableFrom
          ? new Date(draft.availableFrom)
          : null,
        availableUntil: draft.availableUntil
          ? new Date(draft.availableUntil)
          : null,
        participantLimit: draft.participantLimit,
        hideAfterParticipantLimit: draft.hideAfterParticipantLimit,
        settings: draft.settings,
        draftVersionId: version.id,
        updatedAt: new Date(),
      })
      .where(eq(quizzes.id, row.id))
      .returning();
    await replaceAccess(tx, row.id, draft);
    await audit(tx, row.id, actor.id, "quiz.updated", {}, version.id);
    return toQuizView(updated, { includeDefinition: true, version });
  });
}

export async function publishQuiz(actor, quizId) {
  const row = await loadQuizRow(quizId);
  requireQuizManagement(actor, row);
  const version = await loadVersion(row.draftVersionId);
  if (!version || version.status !== "draft")
    throw appError("quiz_draft_version_required", 409);
  const definition = version.settings?.definition || {};
  const validation = validateQuizDefinition({
    ...toQuizView(row),
    version: definition,
  });
  if (!validation.valid)
    throw appError("quiz_validation_failed", 422, validation);
  return await db.transaction(async (tx) => {
    if (row.currentVersionId) {
      await tx
        .update(quizVersions)
        .set({ status: "superseded" })
        .where(eq(quizVersions.id, row.currentVersionId));
    }
    const now = new Date();
    const snapshot = buildPublishedQuizSnapshot(
      { ...toQuizView(row), id: row.id, version: definition },
      version.versionNumber,
    );
    const [publishedVersion] = await tx
      .update(quizVersions)
      .set({
        status: "published",
        settings: { ...version.settings, snapshot },
        publishedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(quizVersions.id, version.id), eq(quizVersions.status, "draft")),
      )
      .returning();
    if (!publishedVersion) throw appError("quiz_publish_conflict", 409);
    const [updated] = await tx
      .update(quizzes)
      .set({
        status: "published",
        currentVersionId: version.id,
        draftVersionId: null,
        publishedAt: now,
        blockedReason: null,
        updatedAt: now,
      })
      .where(eq(quizzes.id, row.id))
      .returning();
    await audit(
      tx,
      row.id,
      actor.id,
      "quiz.published",
      { versionNumber: version.versionNumber },
      version.id,
    );
    return {
      quiz: toQuizView(updated, { version: publishedVersion }),
      validation,
    };
  });
}

export async function changeQuizStatus(actor, quizId, action, reason = "") {
  const row = await loadQuizRow(quizId);
  const adminActions = new Set(["block", "restore", "delete"]);
  if (adminActions.has(action))
    requireQuizCapability(
      actor,
      action === "delete"
        ? QUIZ_CAPABILITIES.DELETE_ANY
        : action === "block"
          ? QUIZ_CAPABILITIES.BLOCK
          : QUIZ_CAPABILITIES.RESTORE,
    );
  else requireQuizManagement(actor, row);
  const now = new Date();
  const updates = { updatedAt: now };
  if (action === "unpublish") updates.status = "unpublished";
  else if (action === "archive") {
    updates.status = "archived";
    updates.archivedAt = now;
  } else if (action === "block") {
    updates.status = "blocked";
    updates.blockedReason = String(reason || "Нарушение правил").slice(
      0,
      2_000,
    );
  } else if (action === "restore") {
    updates.status = row.currentVersionId ? "unpublished" : "draft";
    updates.blockedReason = null;
    updates.archivedAt = null;
  } else if (action === "delete") updates.deletedAt = now;
  else throw appError("quiz_action_invalid", 400);
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(quizzes)
      .set(updates)
      .where(eq(quizzes.id, row.id))
      .returning();
    await audit(
      tx,
      row.id,
      actor.id,
      `quiz.${action}`,
      { reason: reason || null },
      row.currentVersionId,
    );
    return rows;
  });
  return toQuizView(updated);
}

export async function cloneQuiz(actor, quizId) {
  requireQuizCapability(actor, QUIZ_CAPABILITIES.CREATE);
  const row = await loadQuizRow(quizId);
  if (
    !(await canUserAccessQuiz(actor, row, { allowDirectLink: true })) &&
    !canManageQuiz(actor, row)
  )
    throw appError("quiz_not_found", 404);
  const sourceVersion = await loadVersion(
    row.draftVersionId || row.currentVersionId,
  );
  const definition =
    sourceVersion?.settings?.definition ||
    sourceVersion?.settings?.snapshot ||
    {};
  return await createQuiz(actor, {
    ...toQuizView(row),
    id: undefined,
    title: `${row.title} — копия`,
    version: definition,
  });
}

export async function getQuizSnapshotForAttempt(quizId, executor = db) {
  const row = await loadQuizRow(quizId, executor);
  assertQuizPlayable(row);
  const version = await loadVersion(row.currentVersionId, executor);
  const snapshot =
    version?.settings?.snapshot ||
    (version?.settings?.definition
      ? buildPublishedQuizSnapshot(
          {
            ...toQuizView(row),
            id: row.id,
            version: version.settings.definition,
          },
          version.versionNumber,
        )
      : null);
  if (!snapshot) throw appError("quiz_published_version_missing", 409);
  return { quiz: row, version, snapshot };
}

export async function getQuizStatistics(actor, quizId) {
  const row = await loadQuizRow(quizId);
  requireQuizManagement(actor, row);
  const attempts = await db
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.quizId, row.id));
  const completed = attempts.filter(
    (attempt) => attempt.status === "completed",
  );
  const uniqueUsers = new Set(attempts.map((attempt) => attempt.userId));
  const average = (items, key) =>
    items.length
      ? items.reduce((sum, item) => sum + Number(item[key] || 0), 0) /
        items.length
      : 0;
  const resultDistribution = Object.entries(
    completed.reduce((acc, attempt) => {
      const key = attempt.resultKey || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  ).map(([resultKey, count]) => ({ resultKey, count }));
  return {
    quizId: row.id,
    started: attempts.length,
    completed: completed.length,
    incomplete: attempts.filter((attempt) => attempt.status === "in_progress")
      .length,
    completionRate: attempts.length ? completed.length / attempts.length : 0,
    averageDurationSeconds: average(completed, "durationSeconds"),
    averageScore: average(completed, "score"),
    uniqueParticipants: uniqueUsers.size,
    averageAttempts: uniqueUsers.size ? attempts.length / uniqueUsers.size : 0,
    resultDistribution,
  };
}

export {
  appError,
  canUserAccessQuiz,
  loadQuizRow,
  loadVersion,
  toQuizView,
};
