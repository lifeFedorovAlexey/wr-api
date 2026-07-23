export const QUIZ_CAPABILITIES = Object.freeze({
  CREATE: "quiz:create",
  MANAGE_OWN: "quiz:manage-own",
  MANAGE_ANY: "quiz:manage-any",
  DELETE_OWN: "quiz:delete-own",
  DELETE_ANY: "quiz:delete-any",
  BLOCK: "quiz:block",
  RESTORE: "quiz:restore",
  ASSIGN_AUTHOR: "quiz:assign-author",
  SETTINGS: "quiz:settings",
  ATTEMPT: "quiz:attempt",
  VIEW_OWN_ATTEMPTS: "quiz:view-own-attempts",
});

const ROLE_CAPABILITIES = Object.freeze({
  user: [QUIZ_CAPABILITIES.ATTEMPT, QUIZ_CAPABILITIES.VIEW_OWN_ATTEMPTS],
  patron: [
    QUIZ_CAPABILITIES.CREATE,
    QUIZ_CAPABILITIES.MANAGE_OWN,
    QUIZ_CAPABILITIES.DELETE_OWN,
  ],
  streamer: [
    QUIZ_CAPABILITIES.CREATE,
    QUIZ_CAPABILITIES.MANAGE_OWN,
    QUIZ_CAPABILITIES.DELETE_OWN,
  ],
  admin: Object.values(QUIZ_CAPABILITIES),
  owner: Object.values(QUIZ_CAPABILITIES),
});

export function normalizeQuizRoles(user) {
  return Array.from(
    new Set(
      (Array.isArray(user?.roles) ? user.roles : [user?.role])
        .map((role) =>
          String(role || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  );
}

export function hasQuizCapability(user, capability) {
  const wanted = String(capability || "");
  return normalizeQuizRoles(user).some((role) =>
    ROLE_CAPABILITIES[role]?.includes(wanted),
  );
}

export function canManageQuiz(user, quiz) {
  if (hasQuizCapability(user, QUIZ_CAPABILITIES.MANAGE_ANY)) return true;
  return (
    hasQuizCapability(user, QUIZ_CAPABILITIES.MANAGE_OWN) &&
    Number(user?.id || 0) > 0 &&
    Number(user.id) === Number(quiz?.authorId || 0)
  );
}

export function canDeleteQuiz(user, quiz) {
  if (hasQuizCapability(user, QUIZ_CAPABILITIES.DELETE_ANY)) return true;
  return (
    hasQuizCapability(user, QUIZ_CAPABILITIES.DELETE_OWN) &&
    Number(user?.id || 0) > 0 &&
    Number(user.id) === Number(quiz?.authorId || 0)
  );
}

export function requireQuizCapability(user, capability) {
  if (!user)
    throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
  if (!hasQuizCapability(user, capability)) {
    throw Object.assign(new Error("forbidden"), { statusCode: 403 });
  }
  return true;
}

export function requireQuizManagement(user, quiz) {
  if (!user)
    throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
  if (!canManageQuiz(user, quiz)) {
    throw Object.assign(new Error("forbidden"), { statusCode: 403 });
  }
  return true;
}
