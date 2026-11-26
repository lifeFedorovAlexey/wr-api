import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePatchChangeDisplayName,
  resolvePatchChangeDisplayNameWithStatus,
} from "../lib/patchNotePreviewNames.mjs";

const catalog = {
  champions: new Map([[
    "volibear",
    { slug: "volibear", name: "Volibear", nameLocalizations: { ru_ru: "Волибир", en_us: "Volibear" } },
  ]]),
  guideEntities: new Map([
    ["item:boots-of-mana", { kind: "item", slug: "boots-of-mana", name: "Boots of Mana" }],
    ["item:ionian-boots-of-lucidity", { kind: "item", slug: "ionian-boots-of-lucidity", name: "Ionian Boots of Lucidity" }],
  ]),
};

test("resolves Russian champion, item, and rune names in the patch list", () => {
  assert.equal(resolvePatchChangeDisplayName({
    locale: "ru-ru", entityKind: "champion", entitySlug: "volibear", entityName: "Volibear",
  }, catalog), "Волибир");

  assert.equal(resolvePatchChangeDisplayName({
    locale: "ru-ru", entityKind: "champion", entitySlug: "volibear", entityName: "ВОЛИБИР",
  }, catalog), "Волибир");

  assert.equal(resolvePatchChangeDisplayName({
    locale: "ru-ru", entityKind: "item", entitySlug: "boots-of-mana", entityName: "Boots of Mana",
  }, catalog), "Ботинки маны");

  assert.equal(resolvePatchChangeDisplayName({
    locale: "ru-ru", entityKind: "item", entitySlug: "ionian-boots-of-lucidity", entityName: "Ionian Boots of Lucidity",
  }, catalog), "Ионийские сапоги просветления");

  assert.equal(resolvePatchChangeDisplayName({
    locale: "ru-ru", entityKind: "rune", entitySlug: "electrocute", entityName: "Electrocute",
  }, catalog), "Казнь электричеством");
});

test("localizes entity names for Russian UI when only an English patch row exists", () => {
  assert.equal(resolvePatchChangeDisplayName({
    locale: "en-us", entityKind: "item", entitySlug: "boots-of-mana", entityName: "Boots of Mana",
  }, catalog), "Ботинки маны");

  assert.equal(resolvePatchChangeDisplayName({
    locale: "en-us", entityKind: "champion", entitySlug: "volibear", entityName: "VOLIBEAR",
  }, catalog), "Волибир");
});

test("resolves verified historical patch names and exposes untranslated markers", () => {
  const cases = [
    ["spell", "smite", "Smite", "Кара", "localized"],
    ["spell", "teleport", "Teleport", "Телепорт", "localized"],
    ["spell", null, "Barrier", "Барьер", "localized"],
    ["spell", null, "Heal", "Исцеление", "localized"],
    ["spell", null, "Cleanse", "Очищение", "localized"],
    ["spell", null, "Exhaust", "Изнурение", "localized"],
    ["item", "veil", "Veil", "Завеса", "localized"],
    ["item", "repulsor-enchant", "Repulsor Enchant", "Зачарование репульсора", "localized"],
    ["item", null, "Enchantment: Ravenous Hydra", "Зачарование: Ненасытная гидра", "localized"],
    ["rune", "first-strike", "First Strike", "Удар на опережение", "localized"],
    ["rune", "lethal-tempo", "KEYSTONE: LETHAL TEMPO", "Ключевая руна: Смертельный темп", "localized"],
    ["rune", "giant-slayer", "DOMINATION: GIANT SLAYER", "Доминирование: Убийца великанов", "localized"],
    ["rune", null, "KEYSTONE: ARCANE COMET", "Ключевая руна: Магическая комета", "localized"],
    ["rune", null, "KEYSTONE: EMPOWERMENT", "Ключевая руна: Усиление", "localized"],
    ["rune", null, "DOMINATION: EMPOWERED ATTACK", "Доминирование: Усиленная атака", "localized"],
    ["rune", null, "DOMINATION: PSYCHIC WAVE", "Доминирование: Психическая волна", "localized"],
    ["rune", null, "ONSLAUGHT", "Храбрость: Бойня", "localized"],
    ["rune", null, "RESOLVE: OVERGROWTH", "Храбрость: Разрастание", "localized"],
    ["rune", null, "PRECISION: COUP DE GRACE", "Точность: Удар милосердия", "localized"],
    ["rune", null, "INSPIRATION: IXTALI SEEDJAR", "Вдохновение: Банка для семян", "localized"],
    ["rune", null, "INSPIRATION: SWEET TOOTH", "Вдохновение: Сладкоежка", "localized"],
    ["rune", null, "KEYSTONE: FLEET FOOTWORK", "Ключевая руна: Искусное лавирование", "localized"],
    ["rune", null, "KEYSTONE: AFTERSHOCK", "Ключевая руна: Дрожь земли", "localized"],
    ["rune", null, "Brutal", "Жестокость", "localized"],
    ["rune", null, "Sudden Impact", "Внезапный удар", "localized"],
    ["rune", null, "Transcendence", "Превосходство", "localized"],
    ["rune", null, "CONTRACTION: HEXTECH FLASHTRAPTION", "Приспособление: Хекстековый скачок", "localized"],
    ["rune", null, "CONTRAPTION: ITEM CRAFTING", "Приспособление: Создание предметов", "localized"],
    ["item", null, "Light - Horizon Focus", "Свет — Хекстековый прицел", "localized"],
    ["item", null, "Ruin - Sterak's Gage.", "Погибель — Испытание Стерака", "localized"],
    ["item", "blasting-wand", "Blasting Wand", "Разящий жезл", "localized"],
    ["item", "hullbreaker", "Hullbreaker", "Бортолом", "localized"],
    ["item", "black-cleaver", "Black Cleaver", "Черная секира", "localized"],
    ["item", null, "Black Mist Scythe", "Коса черного тумана", "localized"],
    ["item", null, "Bulwark of the Mountain", "Оплот горы", "localized"],
    ["item", null, "Hextech Soulstealer", "Хекстековый пожиратель душ", "localized"],
    ["item", null, "TAILSMAN OF ASCENSION", "Талисман вознесения", "localized"],
    ["item", null, "Gambler's Blade [New to this mode]", "Клинок картежника", "localized"],
    ["item", "revival-enchant", "Revival Enchant", "Зачарование возрождения", "localized"],
    ["item", "hextech-glp-800", "Hextech GLP- 800", "Хекстековая НЛП 800", "localized"],
    ["item", null, "Mana Mune", "Манамунэ", "localized"],
    ["item", null, "Heartsteel", "Сердце стали", "localized"],
    ["item", "big-bully", "Big Bully", "Большой задира", "localized"],
    ["item", null, "Perplexity", "Замешательство", "localized"],
    ["item", null, "Giant Slayer", "Убийца великанов", "localized"],
    ["item", null, "Hexdrinker", "Пожиратель заклятий", "localized"],
    ["item", "mejais-soulstealer", "Mejai's Soulstealer", "Пожиратель душ Меджай", "localized"],
    ["system", null, "Damage dealt", "Наносимый урон", "localized"],
    ["system", null, "Damage received", "Получаемый урон", "localized"],
    ["system", null, "Heal effect", "Эффект лечения", "localized"],
    ["spell", null, "Shield effect", "Shield effect", "untranslated"],
    ["item", null, "YORDLE ITEM UPDATES", "YORDLE ITEM UPDATES", "untranslated"],
    ["item", null, "RETURNING ITEMS", "Повторно добавленные предметы", "localized"],
    ["system", null, "AAA ARAM", "AAA ARAM", "official-brand"],
    ["system", null, "Heartsteel", "Heartsteel", "official-brand"],
    ["system", null, "True Damage", "True Damage", "official-brand"],
    ["system", null, "Rock ’n’ Pentakill", "Rock ’n’ Pentakill", "official-brand"],
    ["skin", "janna-so-janna", "so Janna", "so Janna", "untranslated"],
  ];

  for (const [entityKind, entitySlug, entityName, displayNameRu, nameStatus] of cases) {
    const row = { locale: "en-us", entityKind, entitySlug, entityName };
    assert.deepEqual(resolvePatchChangeDisplayNameWithStatus(row, catalog), { displayNameRu, nameStatus }, entityName);
    assert.equal(resolvePatchChangeDisplayName(row, catalog), displayNameRu, entityName);
  }
});

test("uses official localized names for the Volibear chroma family and old skin rows", () => {
  const cases = [
    ["volibear-legends-showdown-volibear-chromas", "Legends Showdown Volibear chromas", "Цветовые схемы «Гроза легенд Волибир»"],
    ["pyke-ashen-knight-pyke", "Ashen Knight Pyke", "Пепельный рыцарь Пайк"],
    ["jax-stargazer-jax", "Stargazer Jax", "Звездочет Джакс"],
    ["akali-star-guardian-akali", "Star Guardian Akali", "Звездная защитница Акали"],
    ["syndra-prestige-star-guardian-syndra", "Prestige Star Guardian Syndra", "Звездная защитница Синдра (престижное издание)"],
  ];

  for (const [entitySlug, entityName, displayNameRu] of cases) {
    const result = resolvePatchChangeDisplayNameWithStatus({ entityKind: "skin", entitySlug, entityName }, catalog);
    assert.deepEqual(result, { displayNameRu, nameStatus: "localized" }, entitySlug);
  }
});
