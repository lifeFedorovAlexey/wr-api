function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeCategoryScores(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = number(target[key]) + number(value);
  }
  return target;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function selectedOptions(question, answer) {
  const ids = new Set(
    Array.isArray(answer?.selectedOptionIds)
      ? answer.selectedOptionIds.map(String)
      : [],
  );
  return (Array.isArray(question?.options) ? question.options : []).filter(
    (option) => ids.has(String(option.id)),
  );
}

function baseResult() {
  return {
    score: 0,
    categoryScores: {},
    isCorrect: null,
    requiresReview: false,
  };
}

function scoreChoice(question, answer) {
  const result = baseResult();
  const selected = selectedOptions(question, answer);
  const correctIds = new Set(
    (question.options || [])
      .filter((option) => option.isCorrect)
      .map((option) => String(option.id)),
  );
  const selectedIds = new Set(selected.map((option) => String(option.id)));
  const exact =
    correctIds.size === selectedIds.size &&
    [...correctIds].every((id) => selectedIds.has(id));
  const mode = question?.settings?.scoringMode || "exact";

  if (mode === "per_option" || mode === "individual") {
    for (const option of selected) {
      result.score += number(option.score);
      mergeCategoryScores(result.categoryScores, option.categoryScores);
    }
  } else if (mode === "partial") {
    const correctSelected = selected.filter(
      (option) => option.isCorrect,
    ).length;
    const incorrectSelected = selected.length - correctSelected;
    const max = number(question.score, 1);
    result.score = correctIds.size
      ? (correctSelected / correctIds.size) * max
      : 0;
    result.score -=
      incorrectSelected * number(question?.settings?.incorrectPenalty, 0);
  } else if (exact) {
    result.score = number(
      question.score,
      selected.reduce((sum, option) => sum + number(option.score), 0),
    );
    for (const option of selected)
      mergeCategoryScores(result.categoryScores, option.categoryScores);
  }
  result.isCorrect = exact;
  return result;
}

function scoreText(question, answer) {
  const result = baseResult();
  const settings = question.settings || {};
  const mode = settings.mode || "none";
  const value = normalizeText(answer?.textValue);
  if (mode === "manual") {
    result.requiresReview = true;
    return result;
  }
  if (mode === "none") return result;
  let correct = false;
  if (mode === "exact")
    correct = value === normalizeText(settings.expectedValue);
  if (mode === "case_insensitive")
    correct =
      value.toLocaleLowerCase("ru") ===
      normalizeText(settings.expectedValue).toLocaleLowerCase("ru");
  if (mode === "allowed") {
    correct = (settings.allowedValues || []).some(
      (candidate) =>
        normalizeText(candidate).toLocaleLowerCase("ru") ===
        value.toLocaleLowerCase("ru"),
    );
  }
  if (mode === "regex") {
    try {
      const pattern = String(settings.pattern || "");
      correct =
        pattern.length <= 256 &&
        new RegExp(pattern, settings.ignoreCase ? "iu" : "u").test(value);
    } catch {
      correct = false;
    }
  }
  result.isCorrect = correct;
  result.score = correct
    ? number(question.score, 1)
    : number(question?.settings?.incorrectScore, 0);
  return result;
}

function scoreNumber(question, answer) {
  const result = baseResult();
  const value = Number(answer?.numberValue);
  if (!Number.isFinite(value)) return result;
  const settings = question.settings || {};
  const correct =
    settings.mode === "range"
      ? value >= number(settings.min, -Infinity) &&
        value <= number(settings.max, Infinity)
      : settings.mode === "tolerance"
        ? Math.abs(value - number(settings.expectedValue)) <=
          Math.abs(number(settings.tolerance))
        : value === number(settings.expectedValue);
  result.isCorrect = correct;
  result.score = correct
    ? number(question.score, 1)
    : number(settings.incorrectScore, 0);
  return result;
}

function scoreScale(question, answer) {
  const value = number(answer.numberValue);
  return {
    score: number(question?.settings?.scores?.[value], value),
    categoryScores: {},
    isCorrect: null,
    requiresReview: false,
  };
}

function scoreOrderedAnswer(question, answer) {
  const actual = (answer.selectedOptionIds || []).map(String);
  const expected = (question?.settings?.correctOrder || []).map(String);
  const matches = expected.filter((id, index) => actual[index] === id).length;
  const exact = expected.length > 0 && matches === expected.length;
  const score = question?.settings?.partialScoring
    ? number(question.score, 1) * (matches / Math.max(expected.length, 1))
    : exact
      ? number(question.score, 1)
      : 0;
  return { score, categoryScores: {}, isCorrect: exact, requiresReview: false };
}

function scoreMatchingAnswer(question, answer) {
  const pairs = answer.pairs || {};
  const expected = question?.settings?.pairs || {};
  const keys = Object.keys(expected);
  const matches = keys.filter(
    (key) => String(pairs[key]) === String(expected[key]),
  ).length;
  const exact = keys.length > 0 && matches === keys.length;
  const score = question?.settings?.partialScoring
    ? number(question.score, 1) * (matches / Math.max(keys.length, 1))
    : exact
      ? number(question.score, 1)
      : 0;
  return { score, categoryScores: {}, isCorrect: exact, requiresReview: false };
}

function getQuestionScorer(type) {
  if (["single_choice", "multiple_choice", "yes_no", "image_choice"].includes(type))
    return scoreChoice;
  return {
    text: scoreText,
    number: scoreNumber,
    scale: scoreScale,
    sorting: scoreOrderedAnswer,
    matching: scoreMatchingAnswer,
  }[type] || null;
}

export function scoreQuestionAnswer(question = {}, answer = {}) {
  const scorer = getQuestionScorer(question.type);
  return scorer ? scorer(question, answer) : baseResult();
}

function evaluateConditionOperator(condition, context) {
  const handlers = {
    and: () => (condition.conditions || []).every((item) => evaluateQuizCondition(item, context)),
    or: () => (condition.conditions || []).some((item) => evaluateQuizCondition(item, context)),
    not: () => !evaluateQuizCondition(condition.condition, context),
    score_gte: () => number(context.score) >= number(condition.value),
    score_lte: () => number(context.score) <= number(condition.value),
    score_between: () =>
      number(context.score) >= number(condition.min) &&
      number(context.score) <= number(condition.max),
    correct_gte: () => number(context.correctCount) >= number(condition.value),
    incorrect_gte: () => number(context.incorrectCount) >= number(condition.value),
    category_gte: () =>
      number(context.categoryScores?.[condition.category]) >= number(condition.value),
    answer_selected: () =>
      (context.answers?.[condition.questionId]?.selectedOptionIds || [])
        .map(String)
        .includes(String(condition.optionId)),
    role: () =>
      (context.roles || []).map(String).includes(String(condition.value)),
  };
  return handlers[condition.op]?.() ?? false;
}

export function evaluateQuizCondition(condition, context = {}) {
  if (!condition) return true;
  if (Array.isArray(condition))
    return condition.every((item) => evaluateQuizCondition(item, context));
  return evaluateConditionOperator(condition, context);
}

export function selectQuizResult(results = [], context = {}) {
  const ordered = [...results].sort(
    (left, right) => number(right.priority) - number(left.priority),
  );
  return (
    ordered.find(
      (result) =>
        !result.isDefault && evaluateQuizCondition(result.conditions, context),
    ) ||
    ordered.find((result) => result.isDefault) ||
    null
  );
}

export { mergeCategoryScores };
