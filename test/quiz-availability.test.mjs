import test from "node:test";
import assert from "node:assert/strict";

import { isQuizPlayable } from "../lib/quizAvailability.mjs";

test("draft quiz is not playable without a published version", () => {
  assert.equal(
    isQuizPlayable({
      status: "draft",
      currentVersionId: null,
    }),
    false,
  );
});

test("published quiz with a current version is playable", () => {
  assert.equal(
    isQuizPlayable({
      status: "published",
      currentVersionId: 42,
    }),
    true,
  );
});

for (const quiz of [
  { status: "published", currentVersionId: null },
  { status: "unpublished", currentVersionId: 42 },
]) {
  test(`quiz is not playable for ${quiz.status} without the full publication contract`, () => {
    assert.equal(isQuizPlayable(quiz), false);
  });
}
