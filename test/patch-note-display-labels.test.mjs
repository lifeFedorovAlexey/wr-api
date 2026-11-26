import assert from "node:assert/strict";
import test from "node:test";

import { localizePatchNoteDisplayLabels } from "../lib/patchNoteDisplayLabels.mjs";

test("localizes generic new labels in Russian patch detail without changing the source row", () => {
  const source = {
    entityName: "Юнара",
    sectionName: "new.",
    changeName: "new",
    changeType: "new",
    details: [
      { text: "Release note", component: "NEW." },
      { text: "Passive changed", component: "Big Bully" },
    ],
  };

  assert.deepEqual(localizePatchNoteDisplayLabels(source, "ru-ru"), {
    ...source,
    sectionName: "Новое",
    changeName: "Новое",
    details: [
      { text: "Release note", component: "Новое" },
      { text: "Passive changed", component: "Большой задира" },
    ],
  });
  assert.deepEqual(source, {
    entityName: "Юнара",
    sectionName: "new.",
    changeName: "new",
    changeType: "new",
    details: [
      { text: "Release note", component: "NEW." },
      { text: "Passive changed", component: "Big Bully" },
    ],
  });
});

test("does not translate generic labels in the English UI", () => {
  const source = { sectionName: "new", changeName: "new", details: [{ component: "new" }] };
  assert.equal(localizePatchNoteDisplayLabels(source, "en-us"), source);
});
