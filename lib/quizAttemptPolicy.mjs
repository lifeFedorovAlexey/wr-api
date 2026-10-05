function asDate(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countsAsUsed(attempt, settings) {
  if (attempt?.voidedAt || attempt?.status === "voided") return false;
  if (attempt?.status === "completed") return true;
  if (attempt?.status === "timed_out")
    return settings.timedOutAttemptCounts !== false;
  if (attempt?.status === "cancelled")
    return settings.cancelledAttemptCounts === true;
  if (attempt?.status === "in_progress")
    return settings.incompleteAttemptCounts === true;
  return false;
}

function dayKey(value) {
  const date = asDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
}

function blockedEligibility(reason, extra = {}) {
  return {
    allowed: false,
    reason,
    remaining: 0,
    resumeAttemptId: null,
    ...extra,
  };
}

function findInitialRestriction(quiz, adjustments, current) {
  if (
    adjustments.some((item) => item?.type === "deny" && item.active !== false)
  ) {
    return blockedEligibility("attempts_denied");
  }
  if (quiz.availableFrom && current < asDate(quiz.availableFrom))
    return blockedEligibility("quiz_not_started");
  if (quiz.availableUntil && current > asDate(quiz.availableUntil))
    return blockedEligibility("quiz_expired");
  return null;
}

function findResumableAttempt(attempts, settings) {
  const inProgress = attempts.find(
    (attempt) => attempt?.status === "in_progress",
  );
  if (!inProgress || settings.allowResume === false) return null;
  return {
    allowed: true,
    reason: null,
    remaining: null,
    resumeAttemptId: inProgress.id,
  };
}

function countExtraAttempts(adjustments) {
  return adjustments
    .filter((item) => item?.type === "add")
    .reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
}

function buildLimitState(quiz, settings, used, current, extra) {
  const type = quiz.attemptLimitType || "unlimited";
  const configuredLimit = Math.max(1, Number(quiz.attemptLimit) || 1);
  const limit = type === "one" || type === "daily"
    ? 1 + extra
    : type === "fixed" || type === "period"
      ? configuredLimit + extra
      : Infinity;
  let relevantUsed = used.length;

  if (type === "daily") {
    relevantUsed = used.filter(
      (attempt) =>
        dayKey(attempt.completedAt || attempt.startedAt) === dayKey(current),
    ).length;
  }
  if (type === "period") {
    const hours = Math.max(1, Number(settings.periodHours) || 24);
    const boundary = current.getTime() - hours * 60 * 60 * 1000;
    relevantUsed = used.filter(
      (attempt) =>
        (asDate(attempt.completedAt || attempt.startedAt)?.getTime() || 0) >=
        boundary,
    ).length;
  }

  return { limit, relevantUsed };
}

function findAfterDateRestriction(type, settings, used, current) {
  if (type !== "after_date" || !used.length) return null;
  const repeatAfter = asDate(settings.repeatAfter);
  if (!repeatAfter || current >= repeatAfter) return null;
  return blockedEligibility("repeat_not_available_yet", {
    nextAllowedAt: repeatAfter.toISOString(),
  });
}

function latestUsedAttempt(used) {
  return [...used].sort(
    (a, b) =>
      (asDate(b.completedAt || b.startedAt)?.getTime() || 0) -
      (asDate(a.completedAt || a.startedAt)?.getTime() || 0),
  )[0];
}

function findCooldownRestriction(type, settings, used, current) {
  if (type !== "cooldown" || !used.length) return null;
  const last = latestUsedAttempt(used);
  const hours = Math.max(1, Number(settings.cooldownHours) || 24);
  const next = new Date(
    (asDate(last.completedAt || last.startedAt)?.getTime() || 0) +
      hours * 60 * 60 * 1000,
  );
  if (current >= next) return null;
  return blockedEligibility("cooldown_active", {
    nextAllowedAt: next.toISOString(),
  });
}

function buildFinalEligibility(limit, relevantUsed) {
  const allowed = relevantUsed < limit;
  return {
    allowed,
    reason: allowed ? null : "attempt_limit_reached",
    remaining: Number.isFinite(limit)
      ? Math.max(0, limit - relevantUsed)
      : null,
    resumeAttemptId: null,
  };
}

export function evaluateAttemptEligibility({
  quiz = {},
  attempts = [],
  adjustments = [],
  now = new Date(),
} = {}) {
  const current = asDate(now) || new Date();
  const settings = quiz.settings || {};
  const initialRestriction = findInitialRestriction(
    quiz,
    adjustments,
    current,
  );
  if (initialRestriction) return initialRestriction;

  const resumable = findResumableAttempt(attempts, settings);
  if (resumable) return resumable;

  const used = attempts.filter((attempt) => countsAsUsed(attempt, settings));
  const type = quiz.attemptLimitType || "unlimited";
  const limitState = buildLimitState(
    quiz,
    settings,
    used,
    current,
    countExtraAttempts(adjustments),
  );
  const afterDateRestriction = findAfterDateRestriction(
    type,
    settings,
    used,
    current,
  );
  if (afterDateRestriction) return afterDateRestriction;

  const cooldownRestriction = findCooldownRestriction(
    type,
    settings,
    used,
    current,
  );
  if (cooldownRestriction) return cooldownRestriction;

  return buildFinalEligibility(limitState.limit, limitState.relevantUsed);
}
