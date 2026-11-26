import assert from "node:assert/strict";
import test from "node:test";
import { countPatchChampionChanges } from "../lib/patchChampionChangeCounts.mjs";

test("counts unique champion changes per category without depending on images", () => {
  const rows = [
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "champion", entitySlug: "aatrox", changeType: "buff", imageUrl: null },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "champion", entitySlug: "aatrox", changeType: "buff", imageUrl: null },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "champion", entitySlug: "ahri", changeType: "nerf" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "champion", entitySlug: "garen", changeType: "adjustment" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "item", entitySlug: "infinity-edge", changeType: "buff" },
    { patchVersion: "7.3b", locale: "en-us", entityKind: "champion", entitySlug: "aatrox", changeType: "nerf" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "champion", entitySlug: "lux", changeType: "rework" },
  ];

  assert.deepEqual(countPatchChampionChanges(rows).get("7.3b:ru-ru"), {
    buff: 1,
    nerf: 1,
    adjustment: 1,
  });
  assert.deepEqual(countPatchChampionChanges(rows).get("7.3b:en-us"), {
    buff: 0,
    nerf: 1,
    adjustment: 0,
  });
});

test("uses champion names only when rows have no canonical slug", () => {
  const rows = [
    { patchVersion: "4.3d", locale: "en-us", entityKind: "champion", entityName: "Old Champion", changeType: "buff" },
    { patchVersion: "4.3d", locale: "en-us", entityKind: "champion", entityName: " old champion ", changeType: "buff" },
  ];
  assert.deepEqual(countPatchChampionChanges(rows).get("4.3d:en-us"), {
    buff: 1,
    nerf: 0,
    adjustment: 0,
  });
});

test("counts a champion with mixed ability changes once as an adjustment", () => {
  const rows = [
    { patchVersion: "7.3a", locale: "en-us", entityKind: "champion", entitySlug: "ahri", changeType: "buff" },
    { patchVersion: "7.3a", locale: "en-us", entityKind: "champion", entitySlug: "ahri", changeType: "nerf" },
    { patchVersion: "7.3a", locale: "en-us", entityKind: "champion", entitySlug: "ahri", changeType: "nerf" },
    { patchVersion: "7.3a", locale: "en-us", entityKind: "champion", entitySlug: "zed", changeType: "buff" },
  ];

  assert.deepEqual(countPatchChampionChanges(rows).get("7.3a:en-us"), {
    buff: 1,
    nerf: 0,
    adjustment: 1,
  });
});
