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

export function evaluateAttemptEligibility({
  quiz = {},
  attempts = [],
  adjustments = [],
  now = new Date(),
} = {}) {
  const current = asDate(now) || new Date();
  const settings = quiz.settings || {};
  if (
    adjustments.some((item) => item?.type === "deny" && item.active !== false)
  ) {
    return {
      allowed: false,
      reason: "attempts_denied",
      remaining: 0,
      resumeAttemptId: null,
    };
  }
  if (quiz.availableFrom && current < asDate(quiz.availableFrom))
    return {
      allowed: false,
      reason: "quiz_not_started",
      remaining: 0,
      resumeAttemptId: null,
    };
  if (quiz.availableUntil && current > asDate(quiz.availableUntil))
    return {
      allowed: false,
      reason: "quiz_expired",
      remaining: 0,
      resumeAttemptId: null,
    };

  const inProgress = attempts.find(
    (attempt) => attempt?.status === "in_progress",
  );
  if (inProgress && settings.allowResume !== false) {
    return {
      allowed: true,
      reason: null,
      remaining: null,
      resumeAttemptId: inProgress.id,
    };
  }

  const used = attempts.filter((attempt) => countsAsUsed(attempt, settings));
  const extra = adjustments
    .filter((item) => item?.type === "add")
    .reduce((sum, item) => sum + Math.max(0, Number(item.amount) || 0), 0);
  const type = quiz.attemptLimitType || "unlimited";
  let limit = Infinity;
  let relevantUsed = used.length;

  if (type === "one") limit = 1 + extra;
  if (type === "fixed")
    limit = Math.max(1, Number(quiz.attemptLimit) || 1) + extra;
  if (type === "daily") {
    limit = 1 + extra;
    relevantUsed = used.filter(
      (attempt) =>
        dayKey(attempt.completedAt || attempt.startedAt) === dayKey(current),
    ).length;
  }
  if (type === "period") {
    const hours = Math.max(1, Number(settings.periodHours) || 24);
    const boundary = current.getTime() - hours * 60 * 60 * 1000;
    limit = Math.max(1, Number(quiz.attemptLimit) || 1) + extra;
    relevantUsed = used.filter(
      (attempt) =>
        (asDate(attempt.completedAt || attempt.startedAt)?.getTime() || 0) >=
        boundary,
    ).length;
  }
  if (type === "after_date") {
    const repeatAfter = asDate(settings.repeatAfter);
    if (used.length && repeatAfter && current < repeatAfter) {
      return {
        allowed: false,
        reason: "repeat_not_available_yet",
        remaining: 0,
        resumeAttemptId: null,
        nextAllowedAt: repeatAfter.toISOString(),
      };
    }
  }
  if (type === "cooldown" && used.length) {
    const last = [...used].sort(
      (a, b) =>
        (asDate(b.completedAt || b.startedAt)?.getTime() || 0) -
        (asDate(a.completedAt || a.startedAt)?.getTime() || 0),
    )[0];
    const hours = Math.max(1, Number(settings.cooldownHours) || 24);
    const next = new Date(
      (asDate(last.completedAt || last.startedAt)?.getTime() || 0) +
        hours * 60 * 60 * 1000,
    );
    if (current < next)
      return {
        allowed: false,
        reason: "cooldown_active",
        remaining: 0,
        resumeAttemptId: null,
        nextAllowedAt: next.toISOString(),
      };
  }

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
