const QUESTION_TYPES = new Set([
  "single_choice",
  "multiple_choice",
  "yes_no",
  "text",
  "number",
  "image_choice",
  "scale",
  "sorting",
  "matching",
  "information",
]);

const PUBLISHABLE_QUESTION_TYPES = new Set([
  "single_choice",
  "multiple_choice",
  "text",
  "information",
]);

const VISIBILITIES = new Set([
  "registered",
  "direct_link",
  "restricted_users",
  "restricted_roles",
]);

const ATTEMPT_LIMIT_TYPES = new Set([
  "one",
  "fixed",
  "unlimited",
  "daily",
  "period",
  "after_date",
  "cooldown",
]);

function error(code, path, message) {
  return { code, path, message };
}

function validatePersistentMediaUrl(value, path, errors, publicMediaBaseUrl) {
  const candidate = String(value || "").trim();
  if (!candidate) return;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !url.hostname)
      throw new Error("not_https");
    const base = new URL(String(publicMediaBaseUrl || ""));
    const basePath = `${base.pathname.replace(/\/+$/, "")}/`;
    if (
      url.origin !== base.origin ||
      !`${url.pathname}/`.startsWith(basePath)
    ) {
      errors.push(
        error(
          "media_url_not_s3",
          path,
          "Изображение должно находиться в хранилище проекта.",
        ),
      );
    }
    return;
  } catch {
    // Relative and invalid URLs are not durable production assets.
  }
  errors.push(
    error(
      "media_url_not_persistent",
      path,
      "Загрузи изображение в постоянное хранилище.",
    ),
  );
}

function getTargets(question) {
  const targets = [];
  if (question?.defaultNextQuestionId)
    targets.push(question.defaultNextQuestionId);
  for (const option of Array.isArray(question?.options)
    ? question.options
    : []) {
    if (option?.nextQuestionId) targets.push(option.nextQuestionId);
  }
  const branches = Array.isArray(question?.settings?.branches)
    ? question.settings.branches
    : [];
  for (const branch of branches) {
    if (branch?.targetId) targets.push(branch.targetId);
  }
  return Array.from(new Set(targets));
}

function isTerminalTarget(target, resultIds) {
  const text = String(target || "");
  return (
    text === "complete" ||
    (text.startsWith("result:") && resultIds.has(text.slice(7)))
  );
}

function detectCycles(questionMap, resultIds) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function visit(id, trail) {
    if (visiting.has(id)) {
      const start = trail.indexOf(id);
      cycles.push(start >= 0 ? trail.slice(start).concat(id) : [...trail, id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const question = questionMap.get(id);
    for (const target of getTargets(question)) {
      if (isTerminalTarget(target, resultIds) || !questionMap.has(target))
        continue;
      visit(target, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of questionMap.keys()) visit(id, []);
  return cycles;
}

function collectReachable(startId, questionMap, resultIds) {
  const seen = new Set();
  const stack = startId ? [startId] : [];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !questionMap.has(id)) continue;
    seen.add(id);
    for (const target of getTargets(questionMap.get(id))) {
      if (!isTerminalTarget(target, resultIds)) stack.push(target);
    }
  }
  return seen;
}

function validateChoiceOptionScore(questionType, option, path, errors) {
  if (!["single_choice", "multiple_choice", "yes_no"].includes(questionType))
    return;
  const score = Number(option?.score ?? 0);
  const scoreIsValid = option?.isCorrect
    ? [1, 3, 5].includes(score)
    : score === 0;
  if (scoreIsValid) return;
  errors.push(
    error(
      "option_score_invalid",
      path,
      option?.isCorrect
        ? "Для правильного ответа выбери 1, 3 или 5 баллов."
        : "Неправильный ответ должен давать 0 баллов.",
    ),
  );
}

function validateQuestion(question, index, errors, publicMediaBaseUrl) {
  const path = `version.questions.${index}`;
  if (!question?.id)
    errors.push(
      error("question_id_required", `${path}.id`, "У вопроса нет id."),
    );
  if (!QUESTION_TYPES.has(question?.type)) {
    errors.push(
      error(
        "question_type_invalid",
        `${path}.type`,
        "Неизвестный тип вопроса.",
      ),
    );
  }
  if (
    QUESTION_TYPES.has(question?.type) &&
    !PUBLISHABLE_QUESTION_TYPES.has(question.type)
  ) {
    errors.push(
      error(
        "question_type_not_publishable",
        `${path}.type`,
        "Этот тип вопроса пока нельзя публиковать.",
      ),
    );
  }
  if (!String(question?.title || "").trim()) {
    errors.push(
      error(
        "question_title_required",
        `${path}.title`,
        "Добавь заголовок вопроса.",
      ),
    );
  }
  for (const [mediaIndex, media] of (Array.isArray(question?.media)
    ? question.media
    : []
  ).entries()) {
    validatePersistentMediaUrl(
      typeof media === "string" ? media : media?.url,
      `${path}.media.${mediaIndex}`,
      errors,
      publicMediaBaseUrl,
    );
  }
  if (question?.type === "text" && question?.settings?.mode === "manual") {
    errors.push(
      error(
        "manual_review_not_supported",
        `${path}.settings.mode`,
        "Ручная проверка пока недоступна.",
      ),
    );
  }
  const options = Array.isArray(question?.options) ? question.options : [];
  if (
    ["single_choice", "multiple_choice", "image_choice", "yes_no"].includes(
      question?.type,
    )
  ) {
    if (options.length < 2) {
      errors.push(
        error(
          "question_options_required",
          `${path}.options`,
          "Нужно минимум два варианта.",
        ),
      );
    }
    const optionIds = new Set();
    options.forEach((option, optionIndex) => {
      if (!option?.id || optionIds.has(option.id)) {
        errors.push(
          error(
            "answer_option_id_invalid",
            `${path}.options.${optionIndex}.id`,
            "Некорректный id варианта.",
          ),
        );
      }
      optionIds.add(option?.id);
      if (
        !String(option?.text || "").trim() &&
        !String(option?.imageUrl || "").trim()
      ) {
        errors.push(
          error(
            "answer_option_content_required",
            `${path}.options.${optionIndex}`,
            "Вариант ответа пуст.",
          ),
        );
      }
      validatePersistentMediaUrl(
        option?.imageUrl,
        `${path}.options.${optionIndex}.imageUrl`,
        errors,
        publicMediaBaseUrl,
      );
      const scorePath = `${path}.options.${optionIndex}.score`;
      validateChoiceOptionScore(question?.type, option, scorePath, errors);
    });
    if (
      ["single_choice", "multiple_choice", "yes_no"].includes(question?.type) &&
      !options.some((option) => option?.isCorrect)
    ) {
      errors.push(
        error(
          "correct_answer_required",
          `${path}.options`,
          "Не отмечен правильный ответ.",
        ),
      );
    }
  }
}

export function validateQuizDefinition(
  input = {},
  { publicMediaBaseUrl = process.env.S3_PUBLIC_BASE_URL } = {},
) {
  const errors = [];
  const warnings = [];
  const version =
    input?.version && typeof input.version === "object" ? input.version : {};
  const questions = Array.isArray(version.questions) ? version.questions : [];
  const results = Array.isArray(version.results) ? version.results : [];

  if (!String(input.title || "").trim())
    errors.push(error("title_required", "title", "Добавь название."));
  if (!String(input.description || "").trim())
    errors.push(
      error("description_required", "description", "Добавь описание."),
    );
  validatePersistentMediaUrl(
    input.coverUrl,
    "coverUrl",
    errors,
    publicMediaBaseUrl,
  );
  if (!VISIBILITIES.has(input.visibility || "registered")) {
    errors.push(
      error("visibility_invalid", "visibility", "Некорректный режим доступа."),
    );
  }
  if (input.participantLimit != null) {
    errors.push(
      error(
        "participant_limit_not_supported",
        "participantLimit",
        "Лимит участников пока недоступен.",
      ),
    );
  }
  if (!ATTEMPT_LIMIT_TYPES.has(input.attemptLimitType || "unlimited")) {
    errors.push(
      error(
        "attempt_limit_type_invalid",
        "attemptLimitType",
        "Некорректный тип лимита.",
      ),
    );
  }
  if (
    input.attemptLimitType === "fixed" &&
    (!Number.isInteger(input.attemptLimit) || input.attemptLimit < 1)
  ) {
    errors.push(
      error(
        "attempt_limit_invalid",
        "attemptLimit",
        "Лимит должен быть целым положительным числом.",
      ),
    );
  }
  if (
    input.availableFrom &&
    input.availableUntil &&
    new Date(input.availableFrom) >= new Date(input.availableUntil)
  ) {
    errors.push(
      error(
        "availability_dates_invalid",
        "availableUntil",
        "Дата окончания должна быть позже даты начала.",
      ),
    );
  }
  if (!questions.length)
    errors.push(
      error(
        "question_required",
        "version.questions",
        "Добавь хотя бы один вопрос.",
      ),
    );
  questions.forEach((question, index) =>
    validateQuestion(question, index, errors, publicMediaBaseUrl),
  );

  const ids = questions.map((question) => question?.id).filter(Boolean);
  const questionMap = new Map(
    questions
      .filter((question) => question?.id)
      .map((question) => [question.id, question]),
  );
  if (new Set(ids).size !== ids.length)
    errors.push(
      error(
        "question_id_duplicate",
        "version.questions",
        "Id вопросов повторяются.",
      ),
    );
  if (!version.startQuestionId || !questionMap.has(version.startQuestionId)) {
    errors.push(
      error(
        "start_question_required",
        "version.startQuestionId",
        "Не выбран стартовый вопрос.",
      ),
    );
  }

  if (!results.length)
    errors.push(
      error(
        "result_required",
        "version.results",
        "Добавь хотя бы один результат.",
      ),
    );
  const resultIds = new Set(
    results.map((result) => result?.id).filter(Boolean),
  );
  results.forEach((result, index) =>
    validatePersistentMediaUrl(
      result?.imageUrl,
      `version.results.${index}.imageUrl`,
      errors,
      publicMediaBaseUrl,
    ),
  );
  if (results.filter((result) => result?.isDefault).length !== 1) {
    errors.push(
      error(
        "default_result_required",
        "version.results",
        "Нужен ровно один результат по умолчанию.",
      ),
    );
  }

  for (const [questionId, question] of questionMap) {
    const targets = getTargets(question);
    if (!targets.length) {
      errors.push(
        error(
          "branch_dead_end",
          `version.questions.${questionId}`,
          "У вопроса нет перехода.",
        ),
      );
    }
    for (const target of targets) {
      if (!questionMap.has(target) && !isTerminalTarget(target, resultIds)) {
        errors.push(
          error(
            "transition_target_missing",
            `version.questions.${questionId}`,
            `Переход ведёт на отсутствующую цель ${target}.`,
          ),
        );
      }
    }
  }

  for (const cycle of detectCycles(questionMap, resultIds)) {
    errors.push(
      error(
        "branch_cycle",
        "version.questions",
        `Обнаружен цикл: ${cycle.join(" → ")}.`,
      ),
    );
  }

  const reachable = collectReachable(
    version.startQuestionId,
    questionMap,
    resultIds,
  );
  for (const id of questionMap.keys()) {
    if (!reachable.has(id))
      warnings.push(
        error(
          "question_unreachable",
          `version.questions.${id}`,
          "Вопрос недоступен из стартовой точки.",
        ),
      );
  }

  return { valid: errors.length === 0, errors, warnings };
}

export { QUESTION_TYPES };
