import test from "node:test";
import assert from "node:assert/strict";

import {
  QUIZ_CAPABILITIES,
  hasQuizCapability,
  canManageQuiz,
  canDeleteQuiz,
} from "../lib/quizPermissions.mjs";

test("quiz capabilities allow authors and deny ordinary users", () => {
  assert.equal(
    hasQuizCapability({ roles: ["user"] }, QUIZ_CAPABILITIES.CREATE),
    false,
  );
  assert.equal(
    hasQuizCapability({ roles: ["user", "patron"] }, QUIZ_CAPABILITIES.CREATE),
    true,
  );
  assert.equal(
    hasQuizCapability(
      { roles: ["user", "streamer"] },
      QUIZ_CAPABILITIES.CREATE,
    ),
    true,
  );
});

test("quiz ownership protects foreign quizzes", () => {
  const quiz = { authorId: 7 };
  assert.equal(canManageQuiz({ id: 7, roles: ["patron"] }, quiz), true);
  assert.equal(canManageQuiz({ id: 8, roles: ["patron"] }, quiz), false);
  assert.equal(canManageQuiz({ id: 8, roles: ["admin"] }, quiz), true);
  assert.equal(canManageQuiz({ id: 8, roles: ["owner"] }, quiz), true);
});

test("only administrators receive destructive quiz capabilities", () => {
  for (const role of ["user", "patron", "streamer"]) {
    assert.equal(
      hasQuizCapability({ roles: [role] }, QUIZ_CAPABILITIES.DELETE_ANY),
      false,
    );
    assert.equal(
      hasQuizCapability({ roles: [role] }, QUIZ_CAPABILITIES.BLOCK),
      false,
    );
  }
  assert.equal(
    hasQuizCapability({ roles: ["admin"] }, QUIZ_CAPABILITIES.DELETE_ANY),
    true,
  );
});

test("administrators can delete any quiz", () => {
  const foreignQuiz = { authorId: 7 };
  assert.equal(canDeleteQuiz({ id: 9, roles: ["admin"] }, foreignQuiz), true);
  assert.equal(canDeleteQuiz({ id: 9, roles: ["owner"] }, foreignQuiz), true);
});

test("patrons and streamers can delete only their own quizzes", () => {
  for (const role of ["patron", "streamer"]) {
    assert.equal(
      canDeleteQuiz({ id: 7, roles: [role] }, { authorId: 7 }),
      true,
    );
    assert.equal(
      canDeleteQuiz({ id: 8, roles: [role] }, { authorId: 7 }),
      false,
    );
  }
});

test("ordinary users cannot delete quizzes, including their own", () => {
  assert.equal(
    canDeleteQuiz({ id: 7, roles: ["user"] }, { authorId: 7 }),
    false,
  );
});
