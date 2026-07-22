function answerError(code) {
  throw Object.assign(new Error(code), { statusCode: 400 });
}

function normalizedOptionIds(question, input) {
  const ids = Array.isArray(input.selectedOptionIds)
    ? input.selectedOptionIds.map(String)
    : [];
  if (new Set(ids).size !== ids.length) answerError("answer_option_duplicate");
  const allowed = new Set(
    (question.options || []).map((option) => String(option.id)),
  );
  if (ids.some((id) => !allowed.has(id))) answerError("answer_option_invalid");
  return ids;
}

function baseAnswer() {
  return {
    selectedOptionIds: [],
    textValue: null,
    numberValue: null,
    structuredValue: null,
  };
}

export function validateAndNormalizeAnswer(question = {}, input = {}) {
  if (input.structuredValue != null)
    answerError("structured_answer_not_allowed");
  const answer = baseAnswer();

  if (["single_choice", "yes_no", "image_choice"].includes(question.type)) {
    answer.selectedOptionIds = normalizedOptionIds(question, input);
    if (answer.selectedOptionIds.length !== 1)
      answerError("single_choice_count_invalid");
    return answer;
  }

  if (question.type === "multiple_choice") {
    answer.selectedOptionIds = normalizedOptionIds(question, input);
    const min = Number.isInteger(question.settings?.minSelected)
      ? question.settings.minSelected
      : question.isRequired === false
        ? 0
        : 1;
    const max = Number.isInteger(question.settings?.maxSelected)
      ? question.settings.maxSelected
      : (question.options || []).length;
    if (
      answer.selectedOptionIds.length < min ||
      answer.selectedOptionIds.length > max
    ) {
      answerError("selection_count_invalid");
    }
    return answer;
  }

  if (question.type === "text") {
    const value = input.textValue == null ? "" : String(input.textValue).trim();
    if (question.isRequired !== false && !value) answerError("answer_required");
    if (value.length > 20_000) answerError("answer_too_long");
    answer.textValue = value || null;
    return answer;
  }

  if (["number", "scale"].includes(question.type)) {
    const value =
      input.numberValue == null || input.numberValue === ""
        ? null
        : Number(input.numberValue);
    if (value == null) {
      if (question.isRequired !== false) answerError("answer_required");
      return answer;
    }
    if (!Number.isFinite(value)) answerError("number_invalid");
    const min = Number(question.settings?.min);
    const max = Number(question.settings?.max);
    if (Number.isFinite(min) && value < min) answerError("number_out_of_range");
    if (Number.isFinite(max) && value > max) answerError("number_out_of_range");
    const step = Number(question.settings?.step);
    if (Number.isFinite(step) && step > 0) {
      const origin = Number.isFinite(min) ? min : 0;
      const quotient = (value - origin) / step;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9)
        answerError("number_step_invalid");
    }
    answer.numberValue = value;
    return answer;
  }

  if (question.type === "information") return answer;
  answerError("question_type_not_supported");
}
