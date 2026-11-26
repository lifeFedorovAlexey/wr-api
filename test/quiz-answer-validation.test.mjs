import test from "node:test";
import assert from "node:assert/strict";

import { validateAndNormalizeAnswer } from "../lib/quizAnswerValidation.mjs";

const options = [{ id: "a" }, { id: "b" }];

test("single choice requires exactly one existing option", () => {
  assert.deepEqual(
    validateAndNormalizeAnswer(
      { type: "single_choice", isRequired: true, options },
      { selectedOptionIds: ["a"] },
    ),
    {
      selectedOptionIds: ["a"],
      textValue: null,
      numberValue: null,
      structuredValue: null,
    },
  );
  assert.throws(
    () =>
      validateAndNormalizeAnswer(
        { type: "single_choice", isRequired: true, options },
        { selectedOptionIds: ["missing"] },
      ),
    /answer_option_invalid/,
  );
  assert.throws(
    () =>
      validateAndNormalizeAnswer(
        { type: "single_choice", isRequired: true, options },
        { selectedOptionIds: ["a", "b"] },
      ),
    /single_choice_count_invalid/,
  );
});

test("multiple choice enforces uniqueness and selection bounds", () => {
  const question = {
    type: "multiple_choice",
    isRequired: true,
    options,
    settings: { minSelected: 1, maxSelected: 2 },
  };
  assert.throws(
    () =>
      validateAndNormalizeAnswer(question, { selectedOptionIds: ["a", "a"] }),
    /answer_option_duplicate/,
  );
  assert.throws(
    () => validateAndNormalizeAnswer(question, { selectedOptionIds: [] }),
    /selection_count_invalid/,
  );
});

test("structured payload cannot override normalized answer fields", () => {
  assert.throws(
    () =>
      validateAndNormalizeAnswer(
        { type: "single_choice", isRequired: true, options },
        {
          selectedOptionIds: ["a"],
          structuredValue: { selectedOptionIds: ["b"] },
        },
      ),
    /structured_answer_not_allowed/,
  );
});

test("required text and numeric constraints are enforced", () => {
  assert.throws(
    () =>
      validateAndNormalizeAnswer(
        { type: "text", isRequired: true },
        { textValue: "  " },
      ),
    /answer_required/,
  );
  assert.throws(
    () =>
      validateAndNormalizeAnswer(
        {
          type: "number",
          isRequired: true,
          settings: { min: 1, max: 5, step: 2 },
        },
        { numberValue: 4 },
      ),
    /number_step_invalid/,
  );
  assert.equal(
    validateAndNormalizeAnswer(
      {
        type: "number",
        isRequired: true,
        settings: { min: 1, max: 5, step: 2 },
      },
      { numberValue: 5 },
    ).numberValue,
    5,
  );
});
