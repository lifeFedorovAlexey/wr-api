import assert from "node:assert/strict";
import test from "node:test";

import { countPatchChangeEntities } from "../lib/patchNoteEntityCounts.mjs";

test("counts every changed entity kind independently of image availability", () => {
  const rows = [
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "champion", entitySlug: "aatrox", changeType: "buff" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "champion", entitySlug: "aatrox", changeType: "nerf" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "item", entitySlug: "duskblade", imageUrl: null },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "rune", entitySlug: "conqueror" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "spell", entitySlug: "flash" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-stormbringer" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "system", entityName: "Shield" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "system", entityName: "Shield" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "system", entityName: "Healing" },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "item", entitySlug: "duskblade", scope: { type: "game-mode" } },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "item", entitySlug: "mode-only-item", entityName: "Mode-only item", scope: { type: "game-mode" } },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "system", entityName: "ARAM", scope: { type: "game-mode" } },
    { patchVersion: "4.3d", locale: "ru-ru", entityKind: "system", entityName: "ARAM", scope: { type: "game-mode" } },
    { patchVersion: "4.3d", locale: "en-us", entityKind: "item", entitySlug: "duskblade" },
  ];

  assert.deepEqual(countPatchChangeEntities(rows).get("4.3d:ru-ru"), {
    champions: 1,
    items: 2,
    runes: 1,
    spells: 1,
    skins: 1,
    system: 3,
    total: 9,
  });
  assert.deepEqual(countPatchChangeEntities(rows).get("4.3d:en-us"), {
    champions: 0,
    items: 1,
    runes: 0,
    spells: 0,
    skins: 0,
    system: 0,
    total: 1,
  });
});

test("counts a chroma skin family once instead of once per color variant", () => {
  const rows = [
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-legends-showdown-volibear-chromas", entityName: "Legends Showdown Volibear chromas" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-гроза-легенд-волибир-lpl", entityName: "Гроза легенд Волибир (LPL)" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-гроза-легенд-волибир-lck", entityName: "Гроза легенд Волибир (LCK)" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-гроза-легенд-волибир-lec", entityName: "Гроза легенд Волибир (LEC)" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-гроза-легенд-волибир-lcs", entityName: "Гроза легенд Волибир (LCS)" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-гроза-легенд-волибир-lcp", entityName: "Гроза легенд Волибир (LCP)" },
    { patchVersion: "7.3b", locale: "ru-ru", entityKind: "skin", entitySlug: "volibear-гроза-легенд-волибир-cblol", entityName: "Гроза легенд Волибир (CBLOL)" },
  ];

  assert.deepEqual(countPatchChangeEntities(rows).get("7.3b:ru-ru"), {
    champions: 0,
    items: 0,
    runes: 0,
    spells: 0,
    skins: 1,
    system: 0,
    total: 1,
  });
});

test("counts Xayah dark-blue and Rakan turquoise chromas with their base skins", () => {
  const rows = [
    { patchVersion: "7.2", locale: "ru-ru", entityKind: "skin", entitySlug: "xayah-elderwood-xayah", entityName: "Дух леса Шая" },
    { patchVersion: "7.2", locale: "ru-ru", entityKind: "skin", entitySlug: "xayah-elderwood-xayah-indigo", entityName: "Дух леса Шая (темно-синий)" },
    { patchVersion: "7.2", locale: "ru-ru", entityKind: "skin", entitySlug: "rakan-elderwood-rakan", entityName: "Дух леса Рэйкан" },
    { patchVersion: "7.2", locale: "ru-ru", entityKind: "skin", entitySlug: "rakan-elderwood-rakan-turquoise", entityName: "Дух леса Рэйкан (бирюзовый)" },
  ];

  assert.deepEqual(countPatchChangeEntities(rows).get("7.2:ru-ru"), {
    champions: 0,
    items: 0,
    runes: 0,
    spells: 0,
    skins: 2,
    system: 0,
    total: 2,
  });
});

test("groups a single color variant with its base skin, but preserves unrelated parenthetical skin names", () => {
  const rows = [
    { patchVersion: "7.3", locale: "ru-ru", entityKind: "skin", entitySlug: "kayle-dragonslayer-kayle", entityName: "Убийца драконов Кейл" },
    { patchVersion: "7.3", locale: "ru-ru", entityKind: "skin", entitySlug: "kayle-dragonslayer-kayle-amber", entityName: "Убийца драконов Кейл (янтарный)" },
    { patchVersion: "7.3", locale: "ru-ru", entityKind: "skin", entitySlug: "lux-special-edition-lux", entityName: "Особая серия Люкс (2025)" },
  ];

  assert.deepEqual(countPatchChangeEntities(rows).get("7.3:ru-ru"), {
    champions: 0,
    items: 0,
    runes: 0,
    spells: 0,
    skins: 2,
    system: 0,
    total: 2,
  });
});

test("counts legacy section and component labels as systems instead of products", () => {
  const counts = countPatchChangeEntities([
    { patchVersion: "6.2", locale: "en-us", entityKind: "item", entityName: "YORDLE ITEM UPDATES" },
    { patchVersion: "6.0", locale: "en-us", entityKind: "item", entityName: "RETURNING ITEMS" },
    { patchVersion: "4.4b", locale: "en-us", entityKind: "item", entityName: "Mirrored Force" },
    { patchVersion: "4.4c", locale: "en-us", entityKind: "item", entityName: "Sunburst" },
    { patchVersion: "5.2d", locale: "en-us", entityKind: "spell", entityName: "Damage dealt" },
    { patchVersion: "5.2d", locale: "en-us", entityKind: "spell", entityName: "Damage received" },
    { patchVersion: "5.2d", locale: "en-us", entityKind: "spell", entityName: "Shield effect" },
    { patchVersion: "5.2d", locale: "en-us", entityKind: "spell", entityName: "Heal effect" },
    { patchVersion: "5.0c", locale: "en-us", entityKind: "item", entityName: "Gargoyle" },
  ]);

  assert.deepEqual(counts.get("6.2:en-us"), {
    champions: 0, items: 0, runes: 0, spells: 0, skins: 0, system: 1, total: 1,
  });
  assert.deepEqual(counts.get("6.0:en-us"), {
    champions: 0, items: 0, runes: 0, spells: 0, skins: 0, system: 1, total: 1,
  });
  assert.deepEqual(counts.get("4.4b:en-us"), {
    champions: 0, items: 0, runes: 0, spells: 0, skins: 0, system: 1, total: 1,
  });
  assert.deepEqual(counts.get("4.4c:en-us"), {
    champions: 0, items: 0, runes: 0, spells: 0, skins: 0, system: 1, total: 1,
  });
  assert.deepEqual(counts.get("5.2d:en-us"), {
    champions: 0, items: 0, runes: 0, spells: 0, skins: 0, system: 4, total: 4,
  });
  assert.equal(counts.get("5.0c:en-us").items, 1, "a real item keeps the item count");
});
