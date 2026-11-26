import assert from "node:assert/strict";
import test from "node:test";

import { linkPatchItemsToHubBaseline } from "../lib/patchItemBaselineLinks.mjs";

test("links Russian patch item rows to Hub's English item identity through the English patch record", () => {
  const changes = [{ entityKind: "item", entitySlug: "locket-enchant", entityName: "Медальон Железных Солари" }];
  const englishChanges = [{ entityKind: "item", entitySlug: "locket-enchant", entityName: "Locket of the Iron Solari" }];
  const hubItems = [{ slug: "locket-of-the-iron-solari", name: "Locket of the Iron Solari" }];

  assert.deepEqual(linkPatchItemsToHubBaseline(changes, englishChanges, hubItems), [{
    ...changes[0],
    baselineItemSlug: "locket-of-the-iron-solari",
  }]);
});

test("prefers an exact Hub slug and links English changes by a normalized name when needed", () => {
  const hubItems = [
    { slug: "rapid-firecannon", name: "Rapid Firecannon" },
    { slug: "infinity-edge", name: "Infinity Edge" },
  ];
  const changes = [
    { entityKind: "item", entitySlug: "rapid-firecannon", entityName: "Different localized name" },
    { entityKind: "item", entitySlug: "old-infinity-edge-id", entityName: "Infinity Edge" },
  ];

  assert.deepEqual(linkPatchItemsToHubBaseline(changes, [], hubItems).map((change) => change.baselineItemSlug), [
    "rapid-firecannon",
    "infinity-edge",
  ]);
});

test("links localized item identities by aligned ordinal and matching changed values", () => {
  const changes = [{
    ordinal: 9,
    entityKind: "item",
    entitySlug: "locket-enchant",
    entityName: "Медальон Железных Солари",
    changeType: "buff",
    details: [
      { before: "2600", after: "2500" },
      { before: "200", after: "300" },
    ],
  }];
  const englishChanges = [{
    ordinal: 9,
    entityKind: "item",
    entitySlug: "locket-of-the-iron-solari",
    entityName: "Locket of the Iron Solari",
    changeType: "buff",
    details: [
      { before: "2600", after: "2500" },
      { before: "200", after: "300" },
    ],
  }];
  const hubItems = [{ slug: "locket-of-the-iron-solari", name: "Locket of the Iron Solari" }];

  assert.equal(
    linkPatchItemsToHubBaseline(changes, englishChanges, hubItems)[0].baselineItemSlug,
    "locket-of-the-iron-solari",
  );
});

test("does not align localized item identities when changed values differ", () => {
  const changes = [{
    ordinal: 9,
    entityKind: "item",
    entitySlug: "localized-item",
    entityName: "Локализованный предмет",
    changeType: "buff",
    details: [{ before: "100", after: "200" }],
  }];
  const englishChanges = [{
    ordinal: 9,
    entityKind: "item",
    entitySlug: "hub-item",
    entityName: "Hub Item",
    changeType: "buff",
    details: [{ before: "100", after: "300" }],
  }];
  const hubItems = [{ slug: "hub-item", name: "Hub Item" }];

  assert.deepEqual(linkPatchItemsToHubBaseline(changes, englishChanges, hubItems), changes);
});

test("leaves non-item, missing, and ambiguous identities untouched", () => {
  const changes = [
    { entityKind: "champion", entitySlug: "ashe", entityName: "Ashe" },
    { entityKind: "item", entitySlug: "unknown", entityName: "Unknown Item" },
    { entityKind: "item", entitySlug: "ambiguous", entityName: "Twin Item" },
  ];
  const hubItems = [
    { slug: "twin-item-a", name: "Twin Item" },
    { slug: "twin-item-b", name: "Twin Item" },
  ];

  assert.deepEqual(linkPatchItemsToHubBaseline(changes, [], hubItems), changes);
});
