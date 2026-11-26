import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const quizCategories = pgTable(
  "quiz_categories",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    slugUidx: uniqueIndex("quiz_categories_slug_uidx").on(table.slug),
  }),
);

export const quizzes = pgTable(
  "quizzes",
  {
    id: serial("id").primaryKey(),
    authorId: integer("author_id").notNull(),
    title: text("title").notNull(),
    shortDescription: text("short_description"),
    description: text("description").notNull(),
    coverUrl: text("cover_url"),
    categoryId: integer("category_id"),
    tags: text("tags").array().notNull().default([]),
    ageRestriction: integer("age_restriction"),
    language: text("language").notNull().default("ru"),
    estimatedMinutes: integer("estimated_minutes"),
    status: text("status").notNull().default("draft"),
    visibility: text("visibility").notNull().default("registered"),
    attemptLimitType: text("attempt_limit_type").notNull().default("unlimited"),
    attemptLimit: integer("attempt_limit"),
    availableFrom: timestamp("available_from", { withTimezone: true }),
    availableUntil: timestamp("available_until", { withTimezone: true }),
    participantLimit: integer("participant_limit"),
    hideAfterParticipantLimit: boolean("hide_after_participant_limit")
      .notNull()
      .default(false),
    settings: jsonb("settings").notNull().default({}),
    currentVersionId: integer("current_version_id"),
    draftVersionId: integer("draft_version_id"),
    blockedReason: text("blocked_reason"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    statusPublishedIdx: index("quizzes_status_published_idx").on(
      table.status,
      table.publishedAt,
    ),
    authorUpdatedIdx: index("quizzes_author_updated_idx").on(
      table.authorId,
      table.updatedAt,
    ),
    categoryIdx: index("quizzes_category_idx").on(table.categoryId),
  }),
);

export const quizVersions = pgTable(
  "quiz_versions",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    startQuestionId: integer("start_question_id"),
    settings: jsonb("settings").notNull().default({}),
    createdByUserId: integer("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => ({
    quizVersionUidx: uniqueIndex("quiz_versions_quiz_version_uidx").on(
      table.quizId,
      table.versionNumber,
    ),
    quizStatusIdx: index("quiz_versions_quiz_status_idx").on(
      table.quizId,
      table.status,
    ),
  }),
);

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    id: serial("id").primaryKey(),
    quizVersionId: integer("quiz_version_id").notNull(),
    clientKey: text("client_key").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    additionalDescription: text("additional_description"),
    media: jsonb("media").notNull().default([]),
    explanation: text("explanation"),
    externalUrl: text("external_url"),
    isRequired: boolean("is_required").notNull().default(true),
    position: integer("position").notNull(),
    score: doublePrecision("score").notNull().default(0),
    settings: jsonb("settings").notNull().default({}),
    defaultNextQuestionId: integer("default_next_question_id"),
    defaultNextResultId: integer("default_next_result_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    versionPositionUidx: uniqueIndex("quiz_questions_version_position_uidx").on(
      table.quizVersionId,
      table.position,
    ),
    versionClientKeyUidx: uniqueIndex(
      "quiz_questions_version_client_key_uidx",
    ).on(table.quizVersionId, table.clientKey),
    versionIdx: index("quiz_questions_version_idx").on(table.quizVersionId),
  }),
);

export const quizAnswerOptions = pgTable(
  "quiz_answer_options",
  {
    id: serial("id").primaryKey(),
    questionId: integer("question_id").notNull(),
    clientKey: text("client_key").notNull(),
    text: text("text"),
    description: text("description"),
    imageUrl: text("image_url"),
    isCorrect: boolean("is_correct").notNull().default(false),
    score: doublePrecision("score").notNull().default(0),
    categoryScores: jsonb("category_scores").notNull().default({}),
    nextQuestionId: integer("next_question_id"),
    nextResultId: integer("next_result_id"),
    explanation: text("explanation"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    questionPositionUidx: uniqueIndex(
      "quiz_answer_options_question_position_uidx",
    ).on(table.questionId, table.position),
    questionClientKeyUidx: uniqueIndex(
      "quiz_answer_options_question_client_key_uidx",
    ).on(table.questionId, table.clientKey),
    questionIdx: index("quiz_answer_options_question_idx").on(table.questionId),
  }),
);

export const quizResults = pgTable(
  "quiz_results",
  {
    id: serial("id").primaryKey(),
    quizVersionId: integer("quiz_version_id").notNull(),
    clientKey: text("client_key").notNull(),
    title: text("title").notNull(),
    shortDescription: text("short_description"),
    description: text("description"),
    imageUrl: text("image_url"),
    minScore: doublePrecision("min_score"),
    maxScore: doublePrecision("max_score"),
    conditions: jsonb("conditions"),
    recommendations: text("recommendations"),
    actionUrl: text("action_url"),
    actionLabel: text("action_label"),
    priority: integer("priority").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    versionClientKeyUidx: uniqueIndex(
      "quiz_results_version_client_key_uidx",
    ).on(table.quizVersionId, table.clientKey),
    versionIdx: index("quiz_results_version_idx").on(table.quizVersionId),
  }),
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id").notNull(),
    quizVersionId: integer("quiz_version_id").notNull(),
    userId: integer("user_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull().default("in_progress"),
    currentQuestionKey: text("current_question_key"),
    score: doublePrecision("score").notNull().default(0),
    categoryScores: jsonb("category_scores").notNull().default({}),
    resultKey: text("result_key"),
    correctCount: integer("correct_count").notNull().default(0),
    incorrectCount: integer("incorrect_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    visitedQuestionKeys: text("visited_question_keys")
      .array()
      .notNull()
      .default([]),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    timedOutAt: timestamp("timed_out_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    durationSeconds: integer("duration_seconds"),
    lockVersion: integer("lock_version").notNull().default(0),
  },
  (table) => ({
    quizUserNumberUidx: uniqueIndex("quiz_attempts_quiz_user_number_uidx").on(
      table.quizId,
      table.userId,
      table.attemptNumber,
    ),
    userActivityIdx: index("quiz_attempts_user_activity_idx").on(
      table.userId,
      table.lastActivityAt,
    ),
    quizStatusIdx: index("quiz_attempts_quiz_status_idx").on(
      table.quizId,
      table.status,
    ),
    versionIdx: index("quiz_attempts_version_idx").on(table.quizVersionId),
  }),
);

export const quizAttemptAnswers = pgTable(
  "quiz_attempt_answers",
  {
    id: serial("id").primaryKey(),
    attemptId: integer("attempt_id").notNull(),
    questionKey: text("question_key").notNull(),
    requestId: text("request_id").notNull(),
    selectedOptionIds: text("selected_option_ids")
      .array()
      .notNull()
      .default([]),
    textValue: text("text_value"),
    numberValue: doublePrecision("number_value"),
    structuredValue: jsonb("structured_value"),
    score: doublePrecision("score").notNull().default(0),
    categoryScores: jsonb("category_scores").notNull().default({}),
    isCorrect: boolean("is_correct"),
    requiresReview: boolean("requires_review").notNull().default(false),
    answeredAt: timestamp("answered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    attemptQuestionUidx: uniqueIndex(
      "quiz_attempt_answers_attempt_question_uidx",
    ).on(table.attemptId, table.questionKey),
    attemptRequestUidx: uniqueIndex(
      "quiz_attempt_answers_attempt_request_uidx",
    ).on(table.attemptId, table.requestId),
    questionIdx: index("quiz_attempt_answers_question_idx").on(
      table.questionKey,
    ),
  }),
);

export const quizTransitions = pgTable(
  "quiz_transitions",
  {
    id: serial("id").primaryKey(),
    attemptId: integer("attempt_id").notNull(),
    fromQuestionKey: text("from_question_key"),
    toQuestionKey: text("to_question_key"),
    toResultKey: text("to_result_key"),
    trigger: jsonb("trigger").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    attemptCreatedIdx: index("quiz_transitions_attempt_created_idx").on(
      table.attemptId,
      table.createdAt,
    ),
  }),
);

export const quizAccessUsers = pgTable(
  "quiz_access_users",
  {
    quizId: integer("quiz_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.quizId, table.userId],
      name: "quiz_access_users_pk",
    }),
    userIdx: index("quiz_access_users_user_idx").on(table.userId),
  }),
);

export const quizAccessRoles = pgTable(
  "quiz_access_roles",
  {
    quizId: integer("quiz_id").notNull(),
    roleKey: text("role_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.quizId, table.roleKey],
      name: "quiz_access_roles_pk",
    }),
    roleIdx: index("quiz_access_roles_role_idx").on(table.roleKey),
  }),
);

export const quizAttemptAdjustments = pgTable(
  "quiz_attempt_adjustments",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id").notNull(),
    userId: integer("user_id").notNull(),
    type: text("type").notNull(),
    amount: integer("amount"),
    attemptId: integer("attempt_id"),
    reason: text("reason"),
    active: boolean("active").notNull().default(true),
    createdByUserId: integer("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    quizUserIdx: index("quiz_attempt_adjustments_quiz_user_idx").on(
      table.quizId,
      table.userId,
    ),
  }),
);

export const quizReports = pgTable(
  "quiz_reports",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id").notNull(),
    reporterUserId: integer("reporter_user_id").notNull(),
    reason: text("reason").notNull(),
    comment: text("comment"),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedByUserId: integer("resolved_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    quizStatusIdx: index("quiz_reports_quiz_status_idx").on(
      table.quizId,
      table.status,
    ),
  }),
);

export const quizAuditLog = pgTable(
  "quiz_audit_log",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id").notNull(),
    quizVersionId: integer("quiz_version_id"),
    actorUserId: integer("actor_user_id"),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    quizCreatedIdx: index("quiz_audit_log_quiz_created_idx").on(
      table.quizId,
      table.createdAt,
    ),
  }),
);
