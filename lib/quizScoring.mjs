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

export function scoreQuestionAnswer(question = {}, answer = {}) {
  if (
    ["single_choice", "multiple_choice", "yes_no", "image_choice"].includes(
      question.type,
    )
  )
    return scoreChoice(question, answer);
  if (question.type === "text") return scoreText(question, answer);
  if (question.type === "number") return scoreNumber(question, answer);
  if (question.type === "scale") {
    const value = number(answer.numberValue);
    return {
      score: number(question?.settings?.scores?.[value], value),
      categoryScores: {},
      isCorrect: null,
      requiresReview: false,
    };
  }
  if (question.type === "sorting") {
    const actual = (answer.selectedOptionIds || []).map(String);
    const expected = (question?.settings?.correctOrder || []).map(String);
    const matches = expected.filter((id, index) => actual[index] === id).length;
    const exact = expected.length > 0 && matches === expected.length;
    const score = question?.settings?.partialScoring
      ? number(question.score, 1) * (matches / Math.max(expected.length, 1))
      : exact
        ? number(question.score, 1)
        : 0;
    return {
      score,
      categoryScores: {},
      isCorrect: exact,
      requiresReview: false,
    };
  }
  if (question.type === "matching") {
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
    return {
      score,
      categoryScores: {},
      isCorrect: exact,
      requiresReview: false,
    };
  }
  return baseResult();
}

export function evaluateQuizCondition(condition, context = {}) {
  if (!condition) return true;
  if (Array.isArray(condition))
    return condition.every((item) => evaluateQuizCondition(item, context));
  switch (condition.op) {
    case "and":
      return (condition.conditions || []).every((item) =>
        evaluateQuizCondition(item, context),
      );
    case "or":
      return (condition.conditions || []).some((item) =>
        evaluateQuizCondition(item, context),
      );
    case "not":
      return !evaluateQuizCondition(condition.condition, context);
    case "score_gte":
      return number(context.score) >= number(condition.value);
    case "score_lte":
      return number(context.score) <= number(condition.value);
    case "score_between":
      return (
        number(context.score) >= number(condition.min) &&
        number(context.score) <= number(condition.max)
      );
    case "correct_gte":
      return number(context.correctCount) >= number(condition.value);
    case "incorrect_gte":
      return number(context.incorrectCount) >= number(condition.value);
    case "category_gte":
      return (
        number(context.categoryScores?.[condition.category]) >=
        number(condition.value)
      );
    case "answer_selected":
      return (context.answers?.[condition.questionId]?.selectedOptionIds || [])
        .map(String)
        .includes(String(condition.optionId));
    case "role":
      return (context.roles || [])
        .map(String)
        .includes(String(condition.value));
    default:
      return false;
  }
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
