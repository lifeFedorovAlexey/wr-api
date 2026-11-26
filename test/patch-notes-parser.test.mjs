import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "cheerio";

import { assertPatchArticleReadyForImport, extractPatchVersion, parsePatchArticle, parsePatchIndex } from "../lib/patchNotesParser.mjs";
import { buildPatchChangeRows } from "../lib/patchNotesChangeRecords.mjs";
import { buildPatchNoteSourceSectionCoverage } from "../lib/patchNoteSourceSectionCoverage.mjs";

const riot73bItemAdjustments = await readFile(
  new URL("./fixtures/riot-patch-notes-7.3b-items.html", import.meta.url),
  "utf8",
);
const riot73bArticle = await readFile(
  new URL("./fixtures/riot-patch-notes-7.3b-source.html", import.meta.url),
  "utf8",
);
const riotItemScopeCoverage = await readFile(
  new URL("./fixtures/riot-item-scope-coverage.html", import.meta.url),
  "utf8",
);
const riot20ParserExcerpts = await readFile(
  new URL("./fixtures/riot-patch-notes-2.0-parser-excerpts.html", import.meta.url),
  "utf8",
);
const riot20RussianRankReward = await readFile(
  new URL("./fixtures/riot-patch-notes-2.0-russian-rank-reward.html", import.meta.url),
  "utf8",
);
const riot05NestedChampion = await readFile(
  new URL("./fixtures/riot-patch-notes-old-nested-champion.html", import.meta.url),
  "utf8",
);
const supplementalSystemSections = await readFile(
  new URL("./fixtures/supplemental-system-sections.html", import.meta.url),
  "utf8",
);
const historicalParserCoverage = JSON.parse(await readFile(
  new URL("./fixtures/riot-historical-parser-coverage.json", import.meta.url),
  "utf8",
));
const riot43ItemSections = JSON.parse(await readFile(
  new URL("./fixtures/riot-patch-notes-4.3-item-sections.json", import.meta.url),
  "utf8",
));
const riot62kNestedItems = JSON.parse(await readFile(
  new URL("./fixtures/riot-patch-notes-6.2k-nested-items.json", import.meta.url),
  "utf8",
));
const riot11Accordion = JSON.parse(await readFile(
  new URL("./fixtures/riot-patch-notes-1.1-accordion.json", import.meta.url),
  "utf8",
));
const championStatSnapshotFixture = JSON.parse(await readFile(
  new URL("./fixtures/riot-champion-stat-snapshot.json", import.meta.url),
  "utf8",
));

test("extracts patch versions with multi-letter suffixes from Riot titles and URLs", () => {
  assert.equal(extractPatchVersion("Wild Rift Patch Notes 10.2ab"), "10.2ab");
  assert.equal(extractPatchVersion("Описание обновления 10.2ab для Wild Rift"), "10.2ab");
  assert.equal(extractPatchVersion("", "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-10-2ab/"), "10.2ab");
  assert.equal(extractPatchVersion("", "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-102ab/"), "10.2ab");
  assert.equal(extractPatchVersion("", "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-6-2d-adventure-modes"), "6.2d");
  assert.equal(extractPatchVersion("", "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-6-2c-1"), "6.2c");
  assert.equal(extractPatchVersion("", "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-6-2c-adventure-modes"), "6.2c");
  assert.equal(extractPatchVersion("", "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-5-1d"), "5.1d");
  assert.equal(extractPatchVersion("", "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/opisanie-obnovleniya-3-2b-dlya-wild-rift"), "3.2b");
});

test("parses 4.3 support items and system sections symmetrically in English and Russian", () => {
  const expectedItems = [
    ["Ancient Coin", "Древняя монета"],
    ["Spectral Sickle", "Призрачный серп"],
    ["Talisman of Ascension", "Талисман вознесения"],
    ["Black Mist Scythe", "Коса черного тумана"],
    ["Bulwark of the Mountain", "Оплот горы"],
  ];
  const expectedSystems = [
    ["TIME OF PURCHASING ENCHANTMENT IN STORE", "ДОСТУПНОСТЬ ЗАЧАРОВАНИЙ В МАГАЗИНЕ"],
    ["MECHANISM OF STRATEGIC POINT", "БОНУСЫ ДЛЯ ОТСТАЮЩЕЙ КОМАНДЫ"],
    ["NEXUS SHIELD", "ЩИТ НЕКСУСА"],
    ["SCRYER'S BLOOMS", "ЦВЕТКИ ПРОВИДЦА"],
  ];
  const parsedByLocale = new Map();

  for (const locale of ["en-us", "ru-ru"]) {
    const body = historicalParserCoverage["4.3"][locale];
    const changes = parseChanges("4.3", locale, body, emptyCatalog, "");
    parsedByLocale.set(locale, changes);
    const items = changes.filter(({ entityKind }) => entityKind === "item");
    const systems = changes.filter(({ entityKind }) => entityKind === "system");
    const expectedLocaleItems = expectedItems.map((names) => names[locale === "en-us" ? 0 : 1]);
    const expectedLocaleSystems = expectedSystems.map((names) => names[locale === "en-us" ? 0 : 1]);

    for (const name of expectedLocaleItems) assert.ok(items.some((row) => row.entityName === name), `${locale}: missing item ${name}`);
    for (const name of expectedLocaleSystems) {
      assert.ok(systems.some((row) => row.entityName.toLocaleLowerCase(locale) === name.toLocaleLowerCase(locale)), `${locale}: missing system ${name}`);
    }
    assert.equal(items.length, expectedItems.length, `${locale}: item rows should not absorb system sections`);
    assert.equal(systems.length, expectedSystems.length, `${locale}: every system subsection should be present once`);
  }

  assert.equal(parsedByLocale.get("en-us").filter(({ entityKind }) => entityKind === "item").length,
    parsedByLocale.get("ru-ru").filter(({ entityKind }) => entityKind === "item").length);
  assert.equal(parsedByLocale.get("en-us").filter(({ entityKind }) => entityKind === "system").length,
    parsedByLocale.get("ru-ru").filter(({ entityKind }) => entityKind === "system").length);
});

test("recovers general gameplay sections nested under Riot's NEW article group", () => {
  const expected = new Map([
    ["en-us", ["ARAM PROGRESSION TRACK", "CONTROLS", "ELEMENTAL RIFT", "RANKED UPDATES", "LEGENDARY QUEUE"]],
    ["ru-ru", ["Прогресс в ARAM", "Управление", "Стихийные Ущелья", "Изменения рангового режима", "Легендарная очередь"]],
  ]);

  for (const locale of ["en-us", "ru-ru"]) {
    const body = historicalParserCoverage["3.3"][locale];
    const nilah = { slug: "nilah", name: "Nilah", nameLocalizations: { en_us: "Nilah", ru_ru: "Нила" } };
    const catalog = {
      ...emptyCatalog,
      champions: new Map([["nilah", nilah], ["нила", nilah]]),
    };
    const changes = parseChanges("3.3", locale, body, catalog, "");
    const systems = changes.filter(({ entityKind }) => entityKind === "system");
    const champions = changes.filter(({ entityKind }) => entityKind === "champion");

    for (const heading of expected.get(locale)) {
      assert.ok(systems.some(({ entityName }) => entityName.toLocaleLowerCase(locale) === heading.toLocaleLowerCase(locale)), `${locale}: missing ${heading}`);
    }
    assert.equal(systems.some(({ entityName }) => /^(?:new|новое)$/i.test(entityName)), false, `${locale}: article wrapper must not become a system row`);
    assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "champion" && /^(?:events|события)$/i.test(entityName)), false);
    assert.ok(champions.some(({ entityName }) => /Nilah|Нила/i.test(entityName)));
  }
});

test("restores the enclosing system category after a sibling spell subsection", () => {
  const changes = parseChanges("4.4", "en-us", `
    <h2>GAMEPLAY CHANGES</h2>
    <h4>SMITE</h4><ul><li>Cooldown: 20s → 30s</li></ul>
    <h4>RIFT HERALD</h4><ul><li>Damage to Nexus: 775-1125 → Maximum health of Nexus × 25%</li></ul>
  `);
  const herald = changes.find((change) => change.entityKind === "system" && /rift herald/i.test(change.entityName));

  assert.ok(herald);
  assert.ok(herald.details.some((detail) => detail.text.includes("775-1125 → Maximum health of Nexus × 25%")));
});

test("keeps general bug-fix and dated hotfix content from early Riot articles", () => {
  for (const locale of ["en-us", "ru-ru"]) {
    const body = historicalParserCoverage["1.0a"][locale];
    const changes = parseChanges("1.0a", locale, body, emptyCatalog, "");
    const systems = changes.filter(({ entityKind }) => entityKind === "system");
    assert.equal(systems.length, 2, `${locale}: expected one bug-fix row and one hotfix row`);
    assert.ok(systems.some(({ details }) => details.some(({ text }) => /bot|бот|fixed|исправлен/i.test(text))));
    assert.ok(systems.some(({ details }) => details.some(({ text }) => /60fps|60 кадров/i.test(text))));
  }
});

test("classifies a champion nested under an old hotfix heading and associates its exact deltas with the Riot source", () => {
  const camille = { slug: "camille", name: "Camille", nameLocalizations: { en_us: "Camille" } };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["camille", camille]]),
  };
  const article = parsePatchArticle(riot05NestedChampion, "0.5", "en-us", catalog);
  const camilleChange = article.changes.find(({ entityKind, entitySlug }) => entityKind === "champion" && entitySlug === "camille");
  const expectedDeltas = [
    ["AD", "70", "58"],
    ["AD per level", "5.5", "4.55"],
    ["Cooldown", "14.5 / 13 / 11.5 / 10s", "16 / 14 / 12 / 10s"],
  ];
  const coverage = buildPatchNoteSourceSectionCoverage({ source: "riot", html: riot05NestedChampion, article });

  assert.ok(camilleChange, JSON.stringify(article.changes));
  assert.deepEqual(camilleChange.details
    .filter(({ before, after }) => before && after)
    .map(({ label, before, after }) => [label, before, after]), expectedDeltas);
  assert.ok(camilleChange.details.some(({ text }) => text.includes("50% CD refund")));
  assert.equal(article.changes.some(({ entityKind, entityName, details }) => (
    entityKind === "system"
    && /SEP 25 HOTFIX/i.test(entityName)
    && details.some(({ text }) => /AD per level: 5\.5 → 4\.55/.test(text))
  )), false);
  assert.equal(coverage.sourceSectionCount, 1);
  assert.equal(coverage.parsedRecordCount, 1);
  assert.equal(coverage.associatedParsedRecordCount, 1);
  assert.deepEqual(coverage.unmatchedParsedRecords, []);
  assert.deepEqual(coverage.ambiguousParsedRecords, []);
  assert.equal(coverage.sections[0].parsedRecordSamples[0].entityKind, "champion");
  assert.equal(coverage.sections[0].parsedRecordSamples[0].entityName, "Camille");
});

test("extracts champion base-stat snapshots separately from confirmed historical changes", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["zed", { slug: "zed", name: "Zed", nameLocalizations: { en_us: "Zed", ru_ru: "Зед" } }],
    ]),
  };
  const sourceUrl = "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-6-2k/";
  const html = articleHtml("6.2k", "en-us", "", "").replace(
    /<script id="__NEXT_DATA__" type="application\/json">[\s\S]*?<\/script>/,
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { page: {
        url: sourceUrl,
        blades: [
          { type: "articleMasthead", title: "Wild Rift Patch Notes 6.2k" },
          championStatSnapshotFixture,
        ],
      } } },
    })}</script>`,
  );
  const parsed = parsePatchArticle(html, "6.2k", "en-us", catalog);
  const zedSnapshot = parsed.championStatSnapshots.find(({ entitySlug }) => entitySlug === "zed");
  const unlistedSnapshot = parsed.championStatSnapshots.find(({ entityName }) => entityName === "UNLISTED CHAMPION");
  const zedChange = parsed.changes.find(({ entityName }) => entityName === "ZED");

  assert.equal(parsed.championStatSnapshots.length, 2);
  assert.equal(zedSnapshot.patchVersion, "6.2k");
  assert.equal(zedSnapshot.locale, "en-us");
  assert.equal(zedSnapshot.sourceUrl, sourceUrl);
  assert.deepEqual(zedSnapshot.sourceSections, ["OTHER CHAMPION STATS ADJUSTMENTS"]);
  assert.deepEqual(zedSnapshot.stats.map(({ label, value }) => [label, value]), [
    ["Attack Speed Ratio", "0.667"],
    ["Base Attack Speed", "0.667"],
    ["Base Bonus Attack Speed", "0.05"],
    ["Attack Speed per Level", "0.01"],
    ["Base Attack Damage", "60"],
  ]);
  assert.equal(zedSnapshot.stats.some((stat) => "before" in stat || "after" in stat), false);
  assert.equal(unlistedSnapshot.stats.length, 2, "unmatched champion headings still retain source names and stat values");
  assert.deepEqual(zedChange.details.map(({ text }) => text), [
    "Base Attack Damage: 58 → 60",
    "[Removed] Attack Speed: 15%",
  ]);
  assert.equal(parsed.changes.some(({ entityName }) => entityName === "UNLISTED CHAMPION"), false,
    "current-value-only rows must not be classified as changes");
});

test("parses underscored legacy base-stat headings and nested stat rows", () => {
  const champion = { slug: "zed", name: "Zed", nameLocalizations: { en_us: "Zed" } };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["zed", champion]]),
  };
  const sourceUrl = "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-3-3/";
  const page = {
    url: sourceUrl,
    blades: [
      { type: "articleMasthead", title: "Wild Rift Patch Notes 3.3" },
      { type: "characterChanges", characters: [{
        character: { name: "Zed" },
        changes: [{ title: "base_stats", description: { body: "<ul><li>Armor per level: 4.7 → 3.9<ul><li>Armor at level 15: 96 → 85</li></ul></li></ul>" } }],
      }] },
    ],
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
  const parsed = parsePatchArticle(html, "3.3", "en-us", catalog);
  const zed = parsed.changes.find(({ entityName }) => entityName === "Zed");
  const zedSnapshot = parsed.championStatSnapshots.find(({ entitySlug }) => entitySlug === "zed");

  assert.deepEqual(zed.details.map(({ text }) => text), [
    "Armor per level: 4.7 → 3.9",
    "Armor at level 15: 96 → 85",
  ]);
  assert.deepEqual(zedSnapshot.stats.map(({ label, value }) => [label, value]), [
    ["Armor per level", "3.9"],
    ["Armor at level 15", "85"],
  ]);
});

test("parses paragraph-based numeric details in structured champion changes", () => {
  const page = {
    url: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-3d/",
    blades: [
      { type: "articleMasthead", title: "Описание обновления 4.3d" },
      { type: "characterChanges", characters: [{
        character: { name: "Жанна" },
        changes: [{ title: "Западный ветер", description: { body: "<p>Время перезарядки: 7,5/7/6,5/6 секунд → <strong>9/8,5/8/7,5 секунд</strong>.</p>" } }],
      }] },
    ],
  };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["janna", { slug: "janna", name: "Janna", nameLocalizations: { ru_ru: "Жанна" }, aliases: ["Janna", "Жанна"] }]]),
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
  const parsed = parsePatchArticle(html, "4.3d", "ru-ru", catalog);
  const janna = parsed.changes.find(({ entityName }) => entityName === "Жанна");

  assert.ok(janna);
  assert.ok(janna.details.some(({ text }) => text.includes("7,5/7/6,5/6 секунд → 9/8,5/8/7,5 секунд")));
});

const emptyCatalog = {
  champions: new Map(),
  items: new Map(),
  runes: new Map(),
  spells: new Map(),
};

const skinChampionCatalog = {
  ...emptyCatalog,
  champions: new Map([
    ["aatrox", "Aatrox", "Атрокс"], ["ambessa", "Ambessa", "Амбесса"], ["amumu", "Amumu", "Амуму"],
    ["galio", "Galio", "Галио"], ["graves", "Graves", "Грейвз"], ["jax", "Jax", "Джакс"],
    ["jayce", "Jayce", "Джейс"], ["khazix", "Kha'Zix", "Ка'Зикс"], ["lulu", "Lulu", "Лулу"],
    ["master-yi", "Master Yi", "Мастер Йи"], ["nasus", "Nasus", "Насус"], ["ornn", "Ornn", "Орн"],
    ["rakan", "Rakan", "Рэйкан"], ["renekton", "Renekton", "Ренектон"], ["ryze", "Ryze", "Райз"],
    ["senna", "Senna", "Сенна"], ["skarner", "Skarner", "Скарнер"], ["varus", "Varus", "Варус"],
    ["viego", "Viego", "Виего"], ["vi", "Vi", "Вай"], ["viktor", "Viktor", "Виктор"],
    ["xayah", "Xayah", "Шая"], ["zoe", "Zoe", "Зои"],
  ].map(([slug, name, ru]) => [name.toLowerCase(), { slug, name, nameLocalizations: { "ru-ru": ru } }])),
};

function articleHtml(version, locale, body, fragmentId = "ITEM ADJUSTMENTS") {
  const page = {
    url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-${String(version).replace(".", "-")}/`,
    blades: [
      { type: "articleMasthead", title: `Wild Rift Patch Notes ${version}` },
      { type: "articleRichText", fragmentId, richText: { body } },
    ],
  };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page } },
  })}</script>`;
}

function accordionArticleHtml(version, locale, groups) {
  const page = {
    url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-${String(version).replace(".", "-")}/`,
    blades: [
      { type: "articleMasthead", title: `Wild Rift Patch Notes ${version}` },
      { type: "articleRichTextAccordion", groups },
    ],
  };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page } },
  })}</script>`;
}

function parseChanges(version, locale, body, catalog = emptyCatalog, fragmentId) {
  return parsePatchArticle(articleHtml(version, locale, body, fragmentId), version, locale, catalog).changes;
}

test("localizes verified Wild Rift item names by English name and canonical slug", () => {
  const entries = [
    ["Dawnshroud", "dawnshroud", "Утренний покров"],
    ["Jaurim's Fist", "jaurims-fist", "Кулак Чаурим"],
    ["Void Amethyst", "void-amethyst", "Аметист Бездны"],
    ["Shimmering Spark", "shimmering-spark", "Мерцающая искра"],
  ];
  const bodyFor = (names) => `<h2>ITEMS</h2><h3>TIER 3 ITEMS</h3>${names.map((name) => (
    `<h4>${name}</h4><p>Price: 10 → 20</p>`
  )).join("")}`;

  const byEnglishName = parseChanges("7.2", "ru-ru", bodyFor(entries.map(([name]) => name)), emptyCatalog)
    .filter(({ entityKind }) => entityKind === "item");
  for (const [, , russianName] of entries) {
    assert.ok(byEnglishName.some(({ entityName }) => entityName === russianName), russianName);
  }

  const aliasCatalog = {
    ...emptyCatalog,
    items: new Map(entries.map(([name, slug]) => [
      `verified alias ${slug.replaceAll("-", " ")}`,
      { slug, name },
    ])),
  };
  const byCanonicalSlug = parseChanges(
    "7.2",
    "ru-ru",
    bodyFor(entries.map(([, slug]) => `Verified Alias ${slug}`)),
    aliasCatalog,
  ).filter(({ entityKind }) => entityKind === "item");
  for (const [, slug, russianName] of entries) {
    assert.ok(byCanonicalSlug.some((row) => row.entitySlug === slug && row.entityName === russianName), `${slug}: ${russianName}`);
  }

  const englishLocale = parseChanges("7.2", "en-us", bodyFor(entries.map(([name]) => name)), emptyCatalog)
    .filter(({ entityKind }) => entityKind === "item");
  for (const [name] of entries) {
    assert.ok(englishLocale.some(({ entityName }) => entityName === name), name);
  }
});

test("localizes archive item and system identities by typed canonical slug", () => {
  const entries = [
    ["Sundered Sky", "sundered-sky", "Расколотое небо"],
    ["Randuin's Omen", "randuins-omen", "Знамение Рандуина"],
    ["Ancient Coin", "ancient-coin", "Древняя монета"],
    ["Relic Shield", "relic-shield", "Древний щит"],
    ["Spectral Sickle", "spectral-sickle", "Призрачный серп"],
  ];
  const catalog = {
    ...emptyCatalog,
    items: new Map(entries.map(([name, slug]) => [name.toLowerCase().replace(/[’']/g, " "), { slug, name }])),
  };
  const body = `<h2>ITEMS</h2><h3>TIER 3 ITEMS</h3>${entries.map(([name]) => (
    `<h4>${name}</h4><p>Price: 100 → 200</p>`
  )).join("")}`;
  const itemRows = parseChanges("5.0", "ru-ru", body, catalog).filter(({ entityKind }) => entityKind === "item");

  for (const [, slug, russianName] of entries) {
    assert.ok(itemRows.some((row) => row.entitySlug === slug && row.entityName === russianName), `${slug}: ${russianName}`);
  }

  const systemRows = parseChanges("6.2h", "ru-ru", `
    <h2>GAMEPLAY CHANGES</h2><h3>Turrets</h3><p>Damage: 100 → 120</p>
  `).filter(({ entityKind }) => entityKind === "system");
  assert.ok(systemRows.some(({ entityName }) => entityName === "Башни"), JSON.stringify(systemRows));
});

test("keeps branded system names in English when Riot has no Russian translation", () => {
  const rows = parseChanges("7.3", "ru-ru", `
    <h2>ИГРОВЫЕ СИСТЕМЫ</h2>
    <h3>Heartsteel</h3><p>Изменение: 1 → 2</p>
    <h3>True Damage</h3><p>Изменение: 1 → 2</p>
    <h3>Rock 'n' Pentakill</h3><p>Изменение: 1 → 2</p>
  `).filter(({ entityKind }) => entityKind === "system");

  for (const name of ["Heartsteel", "True Damage", "Rock 'n' Pentakill"]) {
    assert.ok(rows.some(({ entityName }) => entityName === name), `${name} should remain a branded name`);
  }
});

test("keeps item groups, system headings, and rune labels out of entity identities", () => {
  const itemChanges = parseChanges("9.0", "en-us", `
    <h2>ITEMS</h2>
    <h3>TIER 3 ITEMS</h3><h4>Sample Sword</h4>
    <ul><li>Build Path:<ul><li>Long Sword + 500g</li></ul></li><li>Passive:<ul><li>Gain 10 attack damage.</li></ul></li></ul>
    <h3>ENERGIZED ITEMS</h3><h4>Sample Bow</h4><ul><li>Attack speed: 20% → 25%</li></ul>
    <h3>BARON NASHOR</h3><p>Health: 10000 → 11000</p>
    <h3>TURRETS</h3><p>Damage: 100 → 120</p>
  `, emptyCatalog);
  const items = itemChanges.filter(({ entityKind }) => entityKind === "item");
  const itemNames = items.map(({ entityName }) => entityName);
  assert.deepEqual(itemNames, ["Sample Sword", "Sample Bow"]);
  assert.ok(items[0].details.some(({ component }) => component === "Build Path"));
  assert.equal(itemChanges.some(({ entityKind, entityName }) => entityKind === "item" && /^(?:BARON NASHOR|TURRETS)$/i.test(entityName)), false);

  const rune = { slug: "sudden-impact", name: "Sudden Impact" };
  const runeChanges = parseChanges("9.0", "en-us", `
    <h2>RUNES</h2>
    <h3>CHAMPION</h3>
    <h3>REMOVED</h3>
    <h4>Old Rune</h4><p>Removed from the game.</p>
    <h3>CHAMPION RUNE REPLACED BY [NEW] SUDDEN IMPACT</h3><p>Damage: 10 → 12</p>
  `, { ...emptyCatalog, runes: new Map([["sudden impact", rune]]) });
  assert.equal(runeChanges.some(({ entityName }) => /^(?:CHAMPION|REMOVED)$/i.test(entityName)), false);
  assert.ok(runeChanges.some(({ entityKind, entitySlug, entityName, changeName }) => (
    entityKind === "rune" && entitySlug === "sudden-impact" && entityName === "Sudden Impact" && changeName === "new"
  )), JSON.stringify(runeChanges));
});

test("parses nested removal-list items and does not duplicate item cards under a mode heading", () => {
  const sourcePage = JSON.parse(load(riotItemScopeCoverage)("script").first().text()).props.pageProps.page;
  const items = new Map([
    ["example blade", { slug: "example-blade", name: "Example Blade" }],
    ["retired blade", { slug: "retired-blade", name: "Retired Blade" }],
    ["theme blade", { slug: "theme-blade", name: "Theme Blade" }],
  ]);
  const html = articleHtml("9.0", "en-us", sourcePage.blades[0].richText.body);
  const parsed = parsePatchArticle(html, "9.0", "en-us", { ...emptyCatalog, items });
  const itemRows = parsed.changes.filter((change) => change.entityKind === "item");
  const themeRows = itemRows.filter((change) => change.entitySlug === "theme-blade");

  assert.ok(itemRows.some((change) => change.entitySlug === "retired-blade" && change.changeName === "removed"));
  assert.equal(themeRows.length, 1);
  assert.deepEqual(themeRows[0].scope?.modeSlugs, ["sonic-waves"]);
});

test("uses an exact accordion group label as the entity for detail-only champion sections", () => {
  const ashe = { slug: "ashe", name: "Ashe", nameLocalizations: { "ru-ru": "Эш" } };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["ashe", ashe], ["эш", ashe]]),
  };
  const html = accordionArticleHtml("4.4c", "en-us", [
    { label: "Ashe", content: { body: "<html><head><title></title></head><body><ul><li>Damage: 0% → <strong>10%</strong></li></ul></body></html>" } },
    { label: "Asher", content: { body: "<p>Damage: 0% → 10%</p>" } },
  ]);
  const rows = parsePatchArticle(html, "4.4c", "en-us", catalog).changes;

  const asheRow = rows.find(({ entitySlug }) => entitySlug === "ashe");
  assert.equal(asheRow?.entityKind, "champion");
  assert.equal(asheRow?.entityName, "Ashe");
  assert.ok(asheRow.details.some(({ before, after, text }) => before === "0%" && after === "10%" && text === "Damage: 0% → 10%"));
  assert.equal(rows.some(({ entityKind, entityName }) => entityKind === "champion" && entityName === "Asher"), false);
});

test("splits consecutive uncatalogued items marked as new to a game mode", () => {
  const changes = parseChanges("6.0", "en-us", `
    <h1>GAMEPLAY CHANGES</h1><h2>Hextech ARAM</h2><h3>New Items</h3>
    <h5>Gambler's Blade [New to this mode]</h5>
    <p>Basic Attributes:</p><ul><li>Total cost: 1700g</li><li>Ability Haste: 10</li></ul>
    <h5>Perplexity [New to this mode]</h5>
    <p>Basic Attributes:</p><ul><li>Total cost: 3000g</li><li>Ability Power: 85</li></ul>
    <h5>Soul Weep [New to this mode]</h5>
    <p>Basic Attributes:</p><ul><li>Total cost: 3000g</li><li>Attack Damage: 40</li></ul>
    <h5>Hellfire Hatchet [New to this mode]</h5>
    <p>Basic Attributes:</p><ul><li>Total cost: 3000g</li><li>Attack Damage: 55</li></ul>
  `, emptyCatalog, "");
  const items = changes.filter(({ entityKind }) => entityKind === "item");

  assert.deepEqual(items.map(({ entityName }) => entityName), [
    "Gambler's Blade", "Perplexity", "Soul Weep", "Hellfire Hatchet",
  ]);
  assert.deepEqual(items.map(({ details }) => details.filter(({ text }) => /^Total cost:/.test(text)).map(({ text }) => text)), [
    ["Total cost: 1700g"], ["Total cost: 3000g"], ["Total cost: 3000g"], ["Total cost: 3000g"],
  ]);
});

test("preserves explanatory paragraphs between rune headings and stat lists", () => {
  const rationaleByRune = new Map([
    ["Grasp of the Undying", "Grasp has been gaining an edge, so we are dialing back its laning damage."],
    ["Aery", "Aery has been providing too much protection, so we are dialing back her late-game shielding."],
  ]);
  const catalog = {
    ...emptyCatalog,
    runes: new Map([...rationaleByRune.keys()].map((name) => [name.toLowerCase(), {
      slug: name.toLowerCase().replaceAll(" ", "-"), name, aliases: [name],
    }])),
  };
  const changes = parseChanges("7.3b", "en-us", `
    <h2>RUNES</h2>
    <h4>Grasp of the Undying</h4><p>${rationaleByRune.get("Grasp of the Undying")}</p>
    <ul><li>Damage: 3.3% Maximum Health → 3% Maximum Health</li></ul>
    <h4>Aery</h4><p>${rationaleByRune.get("Aery")}</p>
    <ul><li>Shield value: 25 → 20</li></ul>
  `, catalog);

  for (const [name, rationale] of rationaleByRune) {
    const rune = changes.find(({ entityName }) => entityName === name);
    assert.ok(rune, `missing rune row: ${name}`);
    assert.ok(rune.details.some(({ text }) => text === rationale), `missing rationale: ${name}`);
    assert.ok(rune.details.some(({ before, after }) => before && after), `missing stat change: ${name}`);
  }
});

test("assigns aggregate item adjustments to catalog items listed in the source", () => {
  const names = [
    ["boots-of-speed", "Boots of Speed"],
    ["boots-of-swiftness", "Boots of Swiftness"],
    ["gluttonous-greaves", "Gluttonous Greaves"],
    ["ionian-boots-of-lucidity", "Ionian Boots of Lucidity"],
    ["mercurys-treads", "Mercury’s Treads"],
    ["plated-steelcaps", "Plated Steelcaps"],
  ];
  const russianNames = [
    ["boots-of-speed", "Ботинки скорости"],
    ["boots-of-swiftness", "Ботинки стремительности"],
    ["gluttonous-greaves", "Алчные наголенники"],
    ["ionian-boots-of-lucidity", "Ионийские сапоги просветления"],
    ["mercurys-treads", "Поступь Меркурия"],
    ["plated-steelcaps", "Бронированные сапоги"],
  ];
  const normalizeAlias = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, " ").replace(/\s+/g, " ").trim();
  const entities = new Map(names.map(([slug, name]) => [slug, { slug, name }]));
  const catalog = {
    ...emptyCatalog,
    items: new Map([...names, ...russianNames].map(([slug, name]) => [normalizeAlias(name), entities.get(slug)])),
  };
  const parsed = parsePatchArticle(articleHtml("3.2b", "en-us", `
    <h3>ITEMS</h3><h4>BOOTS</h4>
    <p>We are adjusting the cost of boots.</p>
    <ul>
      <li>Boots of Speed cost: 500g → <strong>400g</strong></li>
      <li>All tier two upgraded boots cost: 500g → <strong>600g</strong>
        <ul>
          <li>Total cost remains <strong>1000g</strong></li>
          <li>This includes Boots of Swiftness, Gluttonous Greaves, Ionian Boots of Lucidity, Mercury’s Treads, and Plated Steelcaps</li>
        </ul>
      </li>
    </ul>
    <h3>RUNE CHANGES</h3>
  `), "3.2b", "en-us", catalog);
  const items = parsed.changes.filter(({ entityKind }) => entityKind === "item");
  const bySlug = new Map(items.map((item) => [item.entitySlug, item]));

  assert.deepEqual([...bySlug.keys()].sort(), names.map(([slug]) => slug).sort());
  assert.deepEqual(bySlug.get("boots-of-speed").details.map(({ before, after }) => [before, after]), [["500g", "400g"]]);
  for (const [slug] of names.slice(1)) {
    assert.deepEqual(bySlug.get(slug).details.map(({ before, after }) => [before, after]), [["500g", "600g"]]);
  }
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));

  const parsedRu = parsePatchArticle(articleHtml("3.2b", "ru-ru", `
    <h3>ПРЕДМЕТЫ</h3><h4>БОТИНКИ</h4>
    <ul>
      <li>Стоимость ботинок: 500&nbsp;золота → <strong>400&nbsp;золота.</strong></li>
      <li>Стоимость улучшения ботинок: 500&nbsp;золота → <strong>600&nbsp;золота.</strong>
        <ul>
          <li>Общая стоимость: 1000 золота (без изменений).</li>
          <li>Изменения затрагивают Ботинки стремительности, Алчные наголенники, Ионийские сапоги просветления, Поступь Меркурия и Бронированные сапоги.</li>
        </ul>
      </li>
    </ul>
    <h3>ИЗМЕНЕНИЯ РУН</h3>
  `), "3.2b", "ru-ru", catalog);
  const ruBoots = parsedRu.changes.filter(({ entityKind }) => entityKind === "item");
  const ruBySlug = new Map(ruBoots.map((item) => [item.entitySlug, item]));

  assert.deepEqual([...ruBySlug.keys()].sort(), names.map(([slug]) => slug).sort());
  assert.equal(ruBySlug.get("boots-of-speed").entityName, "Ботинки");
  assert.deepEqual(ruBySlug.get("boots-of-speed").details.map(({ before, after }) => [before, after]), [["500 золота", "400 золота."]]);
  for (const [slug] of names.slice(1)) {
    assert.deepEqual(ruBySlug.get(slug).details.map(({ before, after }) => [before, after]), [["500 золота", "600 золота."]]);
  }
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsedRu));
});

test("does not infer item changes from build path transitions", () => {
  const items = new Map([
    ["kircheis shard", { slug: "kircheis-shard", name: "Kircheis Shard" }],
    ["dagger", { slug: "dagger", name: "Dagger" }],
    ["long sword", { slug: "long-sword", name: "Long Sword" }],
  ]);
  const parsed = parsePatchArticle(articleHtml("6.2", "en-us", `
    <h2>ITEMS</h2><h3>OTHER ITEMS</h3><h4>Kircheis Shard</h4>
    <ul><li><p>Attack Damage: 0 → 15</p></li></ul>
    <p>Build Path</p><ul><li>Dagger (500 Gold)+400 Gold → Long Sword (500 Gold)+400 Gold</li></ul>
  `), "6.2", "en-us", { ...emptyCatalog, items });
  const itemRows = parsed.changes.filter(({ entityKind }) => entityKind === "item");

  assert.ok(itemRows.some(({ entitySlug }) => entitySlug === "kircheis-shard"));
  assert.equal(itemRows.some(({ entitySlug }) => entitySlug === "long-sword"), false);
});

test("parses all 4.3 item subsections from the original Riot English and Russian article fragments", () => {
  const expectedNames = {
    "en-us": [
      "DUSKBLADE OF DRAKTHARR", "ANCIENT COIN", "SPECTRAL SICKLE", "RELIC SHIELD",
      "TALISMAN OF ASCENSION", "BLACK MIST SCYTHE", "BULWARK OF THE MOUNTAIN", "HARROWING CRESCENT",
      "TARGON’S BUCKLER", "BOOTS OF MANA", "BOOTS OF DYNAMISM", "BERSERKER’S GREAVES",
      "IONIAN BOOTS OF LUCIDITY", "MERCURY’S TREADS", "PLATED STEELCAPS", "GLUTTONOUS GREAVES",
      "BOOTS OF FUROR", "MAGNETRON ENCHANT", "LOCKET ENCHANT", "PROTOBELT ENCHANT",
      "REDEEMING ENCHANT", "REVIVAL ENCHANT", "PROTECT ENCHANT",
    ],
    "ru-ru": [
      "Сумеречный клинок драктарра", "Древняя монета", "Призрачный серп", "Древний щит",
      "Талисман вознесения", "Коса черного тумана", "Оплот горы", "Страховинский крюк",
      "Баклер таргона", "Ботинки маны", "Ботинки динамичности", "Наголенники берсерка",
      "Ионийские сапоги просветления", "Поступь меркурия", "Бронированные сапоги", "Алчные наголенники",
      "Ботинки ярости", "Зачарование магнита", "ЗАЧАРОВАНИЕ МЕДАЛЬОНА", "Зачарование проторемня",
      "ЗАЧАРОВАНИЕ ИСКУПЛЕНИЯ", "Оживляющий грааль", "ЗАЧАРОВАНИЕ ОБЕРЕГА",
    ],
  };

  for (const locale of ["en-us", "ru-ru"]) {
    const changes = parseChanges("4.3", locale, riot43ItemSections.sources[locale].html, emptyCatalog, "");
    const items = changes.filter(({ entityKind }) => entityKind === "item");
    assert.deepEqual(items.map(({ entityName }) => entityName), expectedNames[locale], `${locale}: all source item headings should be retained in order`);
    if (locale === "en-us") {
      assert.equal(items.find(({ entityName }) => entityName === "LOCKET ENCHANT")?.entitySlug, "locket-enchant",
        "identity resolution should keep the source heading as the display name");
      assert.equal(items.find(({ entityName }) => entityName === "PROTECT ENCHANT")?.entitySlug, "protect-enchant");
    }
    assert.equal(items.filter(({ changeName }) => changeName === "removed").length, 4, `${locale}: removed item headings should remain item records`);
    assert.equal(items.filter(({ sectionName }) => /support|поддержк/i.test(sectionName)).length, 8, `${locale}: support item subsection should be retained`);
    assert.equal(items.filter(({ sectionName }) => /boots|ботинок/i.test(sectionName)).length, 14, `${locale}: boots and enchantments subsection should be retained`);
  }
});

test("parses all groups from Riot's 1.1 articleRichTextAccordion in English and Russian", () => {
  const item = (slug, name) => ({ slug, name });
  const aliasKey = (value) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/ё/g, "е").replace(/[^a-z0-9а-я]+/gi, " ").replace(/\s+/g, " ").trim();
  const caulfield = item("caulfields-warhammer", "Caulfield's Warhammer");
  const lostChapter = item("lost-chapter", "Lost Chapter");
  const ionianBoots = item("ionian-boots-of-lucidity", "Ionian Boots of Lucidity");
  const kindlegem = item("kindlegem", "Kindlegem");
  const knightsVow = item("knights-vow", "Knight's Vow");
  const guardianRune = { slug: "guardian", name: "Guardian" };
  const hunterGenius = { slug: "hunter-genius", name: "Hunter - Genius" };
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["Caulfield's Warhammer", caulfield], ["Боевой молот Колфилда", caulfield],
      ["Lost Chapter", lostChapter], ["Потерянная глава", lostChapter],
      ["Ionian Boots of Lucidity", ionianBoots], ["Ионийские сапоги просветления", ionianBoots],
      ["Kindlegem", kindlegem], ["Воспламеняющий камень", kindlegem],
      ["Guardian's Vow", knightsVow], ["Клятва рыцаря", knightsVow],
    ].map(([alias, entity]) => [aliasKey(alias), entity])),
    runes: new Map([
      ["Guardian", guardianRune],
      ["Hunter - Genius", hunterGenius], ["Охотник: гений", hunterGenius],
    ].map(([alias, entity]) => [aliasKey(alias), entity])),
  };

  for (const locale of ["en-us", "ru-ru"]) {
    const groups = riot11Accordion[locale].groups;
    const article = accordionArticleHtml("1.1", locale, groups);
    const changes = parsePatchArticle(article, "1.1", locale, catalog).changes;
    const items = changes.filter(({ entityKind }) => entityKind === "item");
    const runes = changes.filter(({ entityKind }) => entityKind === "rune");
    const systems = changes.filter(({ entityKind }) => entityKind === "system");
    const caulfieldRow = items.find(({ entitySlug }) => entitySlug === caulfield.slug);
    const lostChapterRow = items.find(({ entitySlug }) => entitySlug === lostChapter.slug);
    const bootsRow = items.find(({ entitySlug }) => entitySlug === ionianBoots.slug);
    const knightsVowRow = items.find(({ entitySlug }) => entitySlug === knightsVow.slug);

    assert.equal(items.length, 34, `${locale}: all item rows across Physical, Magic, Defense, and Boots should be retained`);
    assert.equal(caulfieldRow.sectionName, locale === "en-us" ? "Physical" : "Физический урон");
    assert.deepEqual(caulfieldRow.details.map(({ before, after }) => [before, after]), [[
      locale === "en-us" ? "10% CDR" : "10% сокращения перезарядки",
      locale === "en-us" ? "10 Ability Haste" : "10 ускорения умений.",
    ]]);
    assert.ok(lostChapterRow.details.some(({ text }) => /Passive - Haste|Пассивный эффект – Спешка/.test(text)),
      `${locale}: nested passive detail should remain attached to Lost Chapter`);
    assert.ok(bootsRow.details.some(({ text }) => /Summoner Spell cooldown reduction|Сокращение перезарядки заклинаний призывателя/.test(text)),
      `${locale}: nested boot detail should remain attached to Ionian Boots`);
    assert.ok(knightsVowRow?.details.some(({ before, after }) => before && after),
      `${locale}: Guardian's Vow / Клятва рыцаря must remain an item even when Guardian is a rune alias`);
    assert.equal(runes.length, 1, `${locale}: the rune accordion entry should become one rune record`);
    assert.equal(runes[0].entitySlug, hunterGenius.slug);
    assert.ok(runes[0].details.some(({ before, after }) => before && after), `${locale}: rune stat transition should be parsed`);
    assert.ok(systems.some(({ entityName, details }) => /Blue Buff|синий страж/i.test(entityName) && details.some(({ before, after }) => before && after)),
      `${locale}: the non-catalog Evolved Blue Buff group should be retained as a system change`);
    assert.equal(changes.some(({ entityName }) => /^(?:Physical|Magic|Defense|Boots|Runes|Физический урон|Магический урон|Защита|Ботинки|Руны)$/i.test(entityName)), false,
      `${locale}: category labels must not be emitted as fake entity rows`);
  }
});

test("parses entity-headed accordion stat tables without promoting stat labels to spells", () => {
  const champions = ["jinx", "hecarim", "soraka"].map((name) => [name, { slug: name, name }]);
  const heal = { slug: "heal", name: "Heal" };
  const catalog = {
    ...emptyCatalog,
    champions: new Map(champions),
    spells: new Map([["heal", heal]]),
  };
  const article = accordionArticleHtml("5.2d", "en-us", [{
    label: "EXPAND TO SEE MORE",
    content: { body: `
      <h4>JINX</h4><ul><li>Damage dealt: 100% → 90%</li></ul>
      <h4>HECARIM</h4><ul><li>Damage received: 85% → 95%</li></ul>
      <h4>SORAKA</h4><ul><li>Shield effect: 80% → 75%</li><li>Heal effect: 80% → 75%</li></ul>
    ` },
  }]);

  const changes = parsePatchArticle(article, "5.2d", "en-us", catalog).changes;
  const championChanges = changes.filter(({ entityKind }) => entityKind === "champion");
  assert.deepEqual(championChanges.map(({ entitySlug }) => entitySlug), ["jinx", "hecarim", "soraka"]);
  assert.deepEqual(championChanges.map(({ details }) => details.map(({ before, after }) => [before, after])), [
    [["100%", "90%"]],
    [["85%", "95%"]],
    [["80%", "75%"], ["80%", "75%"]],
  ]);
  assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "spell" && /damage|shield/i.test(entityName)), false);
});

test("resolves unique champion heading typos and keeps unrelated accordion headings as systems", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["viego", { slug: "viego", name: "Viego", aliases: ["Viego"] }],
      ["hecarim", { slug: "hecarim", name: "Hecarim", aliases: ["Hecarim"] }],
    ]),
  };
  const article = accordionArticleHtml("5.0c", "en-us", [{
    label: "EXPAND TO SEE MORE",
    content: { body: `
      <h4>HECARIM</h4><p>Damage received: 90% → 85%</p>
      <h4>VIEGEO</h4><p>Damage received: 100% → 95%</p>
      <h4>THE HAND OF THE BARON BUFF</h4>
      <p><em>Buff Duration</em></p><ul><li>100s → 120s</li></ul>
      <h4>ASPECT OF THE DRAGON</h4>
      <p><em>Buff Duration</em></p><ul><li>90s → 120s</li></ul>
    ` },
  }]);

  const changes = parsePatchArticle(article, "5.0c", "en-us", catalog).changes;
  const viego = changes.find(({ entitySlug }) => entitySlug === "viego");
  assert.equal(viego?.entityKind, "champion");
  assert.deepEqual(viego?.details.map(({ before, after }) => [before, after]), [["100%", "95%"]]);

  for (const entityName of ["THE HAND OF THE BARON BUFF", "ASPECT OF THE DRAGON"]) {
    const row = changes.find((change) => change.entityName === entityName);
    assert.equal(row?.entityKind, "system", `${entityName} is a gameplay system, not a champion`);
    assert.ok(row?.details.some(({ before, after }) => before && after), `${entityName} should retain numeric details`);
  }
  assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "champion"
    && /BARON|DRAGON/i.test(entityName)), false);
});

test("keeps qualified Yordle items separate from their base items in both locales", () => {
  const redemption = { slug: "redemption", name: "Redemption", imageUrl: "https://example.com/redemption.png" };
  const runaansHurricane = {
    slug: "runaans-hurricane",
    name: "Runaan's Hurricane",
    imageUrl: "https://example.com/runaans-hurricane.png",
  };
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["redemption", redemption],
      ["искупление", { ...redemption, name: "Искупление" }],
      ["runaan s hurricane", runaansHurricane],
      ["runaans hurricane", runaansHurricane],
      ["ураган рунаан", { ...runaansHurricane, name: "Ураган Рунаан" }],
    ]),
  };
  const localizedCases = [
    {
      locale: "en-us",
      yordleRunaan: "YORDLE RUNAAN’S HURRICANE",
      windComponent: "Wind’s Favor",
      attackDamage: "Attack Damage: 20 → 15",
      baseRunaan: "RUNAAN’S HURRICANE",
      redemptionComponent: "Redemption",
      redemptionEffect: "This effect can trigger without a nearby ally.",
    },
    {
      locale: "ru-ru",
      yordleRunaan: "ЙОРДЛОВСКИЙ УРАГАН РУНААН",
      windComponent: "Благословение ветра",
      attackDamage: "Сила атаки: 20 → 15",
      baseRunaan: "УРАГАН РУНААН",
      redemptionComponent: "Искупление",
      redemptionEffect: "Эффект срабатывает без союзного чемпиона поблизости.",
    },
  ];

  for (const { locale, yordleRunaan, windComponent, attackDamage, baseRunaan, redemptionComponent, redemptionEffect } of localizedCases) {
    const redemptionName = locale === "en-us" ? "YORDLE REDEMPTION" : "ЙОРДЛОВСКОЕ ИСКУПЛЕНИЕ";
    const baseRedemptionName = locale === "en-us" ? "REDEMPTION" : "ИСКУПЛЕНИЕ";
    const changes = parseChanges("6.2", locale, `
      <h2>ITEMS</h2><h3>ITEM ADJUSTMENTS</h3>
      <h4>${redemptionName}</h4><p>Base Stats</p><ul><li>Ability Haste: 20 → 15</li></ul>
      <p>${redemptionComponent}</p><ul><li>${redemptionEffect}</li></ul>
      <h4>${baseRedemptionName}</h4><ul><li>Heal: 100 → 90</li></ul>
      <h4>${yordleRunaan}</h4><p>${windComponent}</p><ul><li>${attackDamage}</li></ul>
      <h4>${baseRunaan}</h4><ul><li>Attack Speed: 20% → 25%</li></ul>
    `, catalog);
    const rows = buildPatchChangeRows(changes, catalog, [], "6.2");
    const itemRows = rows.filter(({ entityKind }) => entityKind === "item");
    const bySlug = new Map(itemRows.map((row) => [row.entitySlug, row]));

    assert.equal(itemRows.length, 4, `${locale}: Yordle and base item histories should stay separate`);
    assert.ok(bySlug.has("variant-yordle-redemption"));
    assert.ok(bySlug.has("redemption"));
    assert.ok(bySlug.has("variant-yordle-runaans-hurricane"));
    assert.ok(bySlug.has("runaans-hurricane"));
    assert.ok(bySlug.get("variant-yordle-runaans-hurricane").details.some((detail) => detail.component === windComponent));
    assert.ok(bySlug.get("variant-yordle-redemption").details.some((detail) => detail.component === redemptionComponent));
    assert.equal(itemRows.some(({ entityName }) => entityName === windComponent), false);
    assert.ok(bySlug.get("variant-yordle-runaans-hurricane").imageUrl);
  }
});

test("keeps removed Yordle variants separate from returning base items", () => {
  const runaansHurricane = { slug: "runaans-hurricane", name: "Runaan's Hurricane" };
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["runaan s hurricane", runaansHurricane],
      ["runaans hurricane", runaansHurricane],
    ]),
  };
  const changes = parseChanges("7.0", "en-us", `
    <h2>ITEMS</h2>
    <h3>ITEMS REMOVED</h3><ul><li>Yordle Runaan’s Hurricane</li></ul>
    <h3>RETURNING ITEMS</h3><ul><li>Runaan’s Hurricane</li></ul>
  `, catalog);
  const rows = buildPatchChangeRows(changes, catalog, [], "7.0").filter(({ entityKind }) => entityKind === "item");
  const bySlug = new Map(rows.map((row) => [row.entitySlug, row]));

  assert.equal(rows.length, 2);
  assert.equal(bySlug.get("variant-yordle-runaans-hurricane")?.changeType, "removed");
  assert.equal(bySlug.get("runaans-hurricane")?.changeName, "returning");
});

test("keeps themed item sections and returning-item headings out of the item identity list", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([[
      "yordle redemption", { slug: "yordle-redemption", name: "Yordle Redemption" },
    ], ["eclipse", { slug: "eclipse", name: "Eclipse" }]]),
  };
  const changes = parseChanges("9.9", "en-us", `
    <h2>ITEMS</h2>
    <h3>YORDLE ITEM UPDATES</h3><p>Items infused with Bandle magic have changed.</p>
    <h3>ITEM ADJUSTMENTS</h3>
    <h4>Yordle Redemption</h4><p>Ability Haste: 20 → 15.</p>
    <h3>RETURNING ITEMS</h3>
    <ul><li><p>Soulstealer</p></li><li><p>Stormrazor</p></li></ul>
    <h2>NEW ITEMS</h2>
    <h3>Uncatalogued New Item</h3><p>Added to the shop this patch.</p>
    <h2>ITEM ADJUSTMENTS</h2><h3>OTHER ITEMS</h3>
    <h4>Eclipse</h4><p>Attack Damage: 60 → 65.</p>
    <h2>NEW ITEMS</h2>
    <h3>Augment pool Adjustments</h3><p>We optimized the Augment pool.</p>
    <h3>Augments Adjustments</h3><p>Several Augment values were improved.</p>
  `, catalog, "");

  assert.ok(changes.some(({ entityKind, entitySlug }) => entityKind === "item" && entitySlug === "yordle-redemption"));
  assert.ok(changes.some(({ entityKind, entityName, changeName }) => entityKind === "item"
    && entityName === "Uncatalogued New Item" && changeName === "new"));
  assert.ok(changes.some(({ entityKind, entitySlug, changeName }) => entityKind === "item"
    && entitySlug === "eclipse" && changeName !== "new"));
  for (const heading of ["YORDLE ITEM UPDATES", "RETURNING ITEMS"]) {
    assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "item" && entityName === heading), false);
  }
  for (const heading of ["Augment pool Adjustments", "Augments Adjustments"]) {
    assert.ok(changes.some(({ entityKind, entityName }) => entityKind === "system" && entityName === heading));
    assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "item" && entityName === heading), false);
  }
  assert.ok(changes.some(({ entityKind, entityName }) => entityKind === "item" && entityName === "Soulstealer"));
  assert.ok(changes.some(({ entityKind, entityName }) => entityKind === "item" && entityName === "Stormrazor"));
});

test("treats Yordle item updates as a system section, not an item entity", () => {
  const changes = parseChanges("6.2", "en-us", `
    <h2>ITEMS</h2>
    <h3>YORDLE ITEM UPDATES</h3><p>Item cost: 100 → 200.</p>
  `, emptyCatalog);

  assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "item" && entityName === "YORDLE ITEM UPDATES"), false);
  assert.ok(changes.some(({ entityKind, entityName }) => entityKind === "system" && entityName === "YORDLE ITEM UPDATES"));
});

test("splits a generic removed-items heading into its listed entities", () => {
  const changes = parseChanges("7.3", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>MARKSMAN ITEM ADJUSTMENTS</h3>
    <h4>Removed</h4><ul><li>Old Item One</li><li>Old Item Two</li></ul>
    <h3>OTHER ITEM ADJUSTMENTS</h3>
  `, emptyCatalog, "");
  const items = changes.filter(({ entityKind }) => entityKind === "item");
  assert.deepEqual(items.map(({ entityName }) => entityName), ["Old Item One", "Old Item Two"]);
  assert.equal(items.some(({ entityName }) => entityName === "Removed"), false);
  assert.ok(items.every(({ changeName }) => changeName === "removed"));
});

test("uses nested item names instead of explanatory prose in removed-item lists", () => {
  const changes = parseChanges("7.3", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>ITEM ADJUSTMENTS</h3><h4>Removed</h4>
    <ul>
      <li>As mentioned above, Magnetic Blaster has been removed due to being too much of an all-purpose item.
        <ul><li>Magnetic Blaster</li></ul>
      </li>
      <li>Soul Transfer has struggled to find its intended audience, so we've decided to take it off the Rift for now.
        <ul><li>Soul Transfer</li></ul>
      </li>
    </ul>
  `, emptyCatalog, "");
  const items = changes.filter(({ entityKind }) => entityKind === "item");

  assert.deepEqual(items.map(({ entityName }) => entityName), ["Magnetic Blaster", "Soul Transfer"]);
  assert.ok(items.every(({ changeName }) => changeName === "removed"));
});

test("only removes explicit nested item leaves when explanatory bullets mention other catalog items", () => {
  const itemNames = ["Shimmering Spark", "Searing Crown", "Surging Scales", "Chain Vest", "Stinger"];
  const items = new Map(itemNames.map((name) => [name.toLowerCase(), {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""),
    name,
  }]));
  const changes = parseChanges("9.1", "en-us", `
    <h2>Item Adjustments</h2><h3>Other Item Adjustments</h3><h4>Items Removed</h4>
    <ul>
      <li>Like Shimmering Spark, this item no longer fits the jungle system.
        <ul><li>Searing Crown</li></ul>
      </li>
      <li>Surging Scales has not found a clear identity next to Chain Vest.
        <ul><li>Surging Scales</li></ul>
      </li>
      <li>Stinger has lost its last user.
        <ul><li>Stinger</li><li>See above.</li><li>Searing Crown</li></ul>
      </li>
    </ul>
  `, { ...emptyCatalog, items });
  const removed = changes.filter(({ entityKind, changeName }) => entityKind === "item" && changeName === "removed");

  assert.deepEqual(removed.map(({ entitySlug }) => entitySlug).sort(), ["searing-crown", "stinger", "surging-scales"]);
  assert.equal(removed.some(({ entitySlug }) => ["shimmering-spark", "chain-vest"].includes(entitySlug)), false);
});

test("ends the item adjustment scan when an article changes to battlefield headings", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([["dagger", { slug: "dagger", name: "Dagger" }]]),
  };
  const changes = parseChanges("7.3a", "en-us", `
    <h2>Items</h2><h3>Dagger</h3><ul><li>Price: 500 → 400</li></ul>
    <h2>Other Battlefield Content</h2><p>Smite</p><ul><li>Damage: 30 → 22</li></ul>
    <h2>Nexus</h2><ul><li>Maximum Health: 5500 → 4000</li></ul>
  `, catalog, "");
  const items = changes.filter(({ entityKind }) => entityKind === "item");

  assert.deepEqual(items.map(({ entityName }) => entityName), ["Dagger"]);
  assert.ok(changes.some(({ entityKind, entityName }) => entityKind === "system" && entityName === "Nexus"));
});

test("strips the generic Runes wrapper before resolving an archived rune heading", () => {
  const darkHarvest = { slug: "dark-harvest", name: "Dark Harvest" };
  const catalog = { ...emptyCatalog, runes: new Map([["dark harvest", darkHarvest]]) };
  const changes = parseChanges("6.3a", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>NEW RUNES</h3>
    <h4>Runes: Dark Harvest</h4><p>Adaptive damage and soul collection.</p>
  `, catalog, "");
  const rune = changes.find(({ entityKind }) => entityKind === "rune");
  assert.equal(rune.entitySlug, "dark-harvest");
  assert.equal(rune.entityName, "Dark Harvest");
});

test("resolves cached historical rune identities across tree, status, dash, and locale wrappers", () => {
  const cases = [
    ["2.3", "ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>РУНЫ</h3>
      <h4>УДАЛЕНО</h4>
      <h4>ХРАБРОСТЬ: АДАПТИВНЫЙ ПАНЦИРЬ</h4><p>Получение здоровья: 50 → 60.</p>
      <h4>ХРАБРОСТЬ: НАКОПЛЕНИЕ</h4><p>Броня: 5 → 7.</p>
      <h4>ВДОХНОВЕНИЕ: МЫСЛИТЕЛЬ</h4><p>Золото за убийство объекта: 100 → 120.</p>
    `, ["adaptive-carapace", "conditioning", "mastermind"]],
    ["3.5", "ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>ИЗМЕНЕНИЯ РУН</h3>
      <h4>[ПЕРЕРАБОТКА] ВДОХНОВЕНИЕ: СЛЕДОПЫТ</h4><p>Скорость передвижения: 8% → 10%.</p>
      <h4>ХРАБРОСТЬ: АДАПТИВНЫЙ ПАНЦИРЬ</h4><p>Сопротивление: 8 → 10.</p>
    `, ["pathfinder", "adaptive-carapace"]],
    ["3.0b", "ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>ИЗМЕНЕНИЯ РУН</h3>
      <h4>– НАКОПЛЕНИЕ</h4><p>Защита: 5 → 7.</p>
      <h4>– ОХОТНИК: ТИТАН</h4><p>Здоровье: 20 → 25.</p>
    `, ["conditioning", "hunter-titan"]],
    ["3.2", "ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>НОВЫЕ РУНЫ</h3>
      <h4>– АБСОЛЮТНЫЙ ЩИТ</h4><p>Щит: 50 → 60.</p>
      <h4>– МЫСЛИТЕЛЬ</h4><p>Золото: 100 → 120.</p>
    `, ["ultimate-shield", "mastermind"]],
    ["5.1", "en-us", `
      <h2>GAMEPLAY CHANGES</h2><h3>NEW RUNES</h3>
      <h4>ONSLAUGHT</h4><p>Attack speed: 5% → 7%.</p>
    `, ["onslaught"]],
  ];

  for (const [version, locale, body, expected] of cases) {
    const changes = parseChanges(version, locale, body);
    const runes = changes.filter(({ entityKind }) => entityKind === "rune");
    assert.deepEqual(runes.map(({ entitySlug }) => entitySlug), expected, `${version}/${locale}`);
    assert.equal(runes.some(({ entityName }) => /^удалено$/i.test(entityName)), false, `${version}/${locale}: status label is not a rune`);
  }
});

test("normalizes historical item markers and mode notes without collapsing mode-qualified names", () => {
  const items = new Map([
    ["ravenous hydra", { slug: "ravenous-hydra", name: "Ravenous Hydra" }],
    ["gambler s blade", { slug: "gamblers-blade", name: "Gambler's Blade" }],
    ["spirit visage", { slug: "spirit-visage", name: "Spirit Visage" }],
    ["titanic hydra", { slug: "titanic-hydra", name: "Titanic Hydra" }],
    ["horizon focus", { slug: "horizon-focus", name: "Horizon Focus" }],
  ]);
  const catalog = { ...emptyCatalog, items };
  const changes = parseChanges("5.2", "en-us", `
    <h2>ITEMS</h2>
    <h3>.[NEW] RAVENOUS HYDRA</h3><p>Attack damage: 70 → 75.</p>
    <h3>Gambler's Blade [New for this mode]</h3><p>Gold: 1 → 2.</p>
    <h3>Spirit Visage [Removed].</h3><p>Removed from the game.</p>
    <h3>TITANIC HYDRA. Параметры</h3><p>Health: 500 → 550.</p>
    <h3>Light - Horizon Focus</h3><p>Magic damage: 10 → 12.</p>
    <h3>Предметы 3-го ранга (легендарные)</h3>
    <h3>Заряженные предметы</h3>
  `, catalog, "");
  const itemRows = changes.filter(({ entityKind }) => entityKind === "item");

  assert.deepEqual(itemRows.map(({ entitySlug }) => entitySlug), [
    "ravenous-hydra", "gamblers-blade", "spirit-visage", "titanic-hydra", undefined,
  ]);
  assert.equal(itemRows[0].changeName, "new");
  assert.equal(itemRows[1].entityName, "Gambler's Blade");
  assert.equal(itemRows[2].changeName, "removed");
  assert.equal(itemRows[4].entityName, "Light - Horizon Focus");
  assert.equal(changes.some(({ entityName }) => entityName === "Предметы 3-го ранга (легендарные)"), false);
  assert.equal(changes.some(({ entityName }) => entityName === "Заряженные предметы"), false);
});

test("strips the Contraption category prefix before resolving the historical Item Crafting rune", () => {
  const itemCrafting = { slug: "item-crafting", name: "Item Crafting" };
  const catalog = { ...emptyCatalog, runes: new Map([["item crafting", itemCrafting]]) };
  const changes = parseChanges("5.0c", "en-us", `
    <h2>RUNE CHANGES</h2>
    <h3>CONTRAPTION: ITEM CRAFTING</h3>
    <p>Item crafting has been too expensive to use, so we are adjusting the amount of gold needed.</p>
    <p><em>Passive</em></p>
    <ul><li>Generate a stack every 180 seconds; outside purchase cost: 150 → 50 Gold</li></ul>
  `, catalog, "");
  const rune = changes.find(({ entityKind }) => entityKind === "rune");
  assert.equal(rune?.entitySlug, "item-crafting");
  assert.equal(rune?.entityName, "Item Crafting");
  assert.ok(rune?.details.some(({ text }) => /150\s*→\s*50/u.test(text)));
});

test("normalizes generic new and removed item wrappers and rune tree prefixes", () => {
  const examples = [
    ["en-us", `
      <h2>GAMEPLAY CHANGES</h2><h3>ITEMS</h3>
      <h4>NEW ENCHANTMENT: Sample Enchant</h4><p>New enchantment description.</p>
      <h4>Shadows Enchant - REMOVED</h4><p>Removed enchantment description.</p>
      <h3>NEW RUNES</h3><h4>KEYSTONE: Sample Rune</h4><p>Rune description.</p>
      <h4>LEGEND: Another Rune</h4><p>Another rune description.</p>
    `, ["Sample Enchant", "Shadows Enchant"], ["Sample Rune", "Another Rune"]],
    ["ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>ПРЕДМЕТЫ</h3>
      <h4>НОВОЕ ЗАЧАРОВАНИЕ: Тестовое зачарование</h4><p>Описание нового зачарования.</p>
      <h4>Удалено: Зачарование теней</h4><p>Описание удаленного зачарования.</p>
      <h3>НОВЫЕ РУНЫ</h3><h4>КЛЮЧЕВАЯ РУНА: Пример руны</h4><p>Описание руны.</p>
      <h4>ЛЕГЕНДА: Другая руна</h4><p>Описание другой руны.</p>
    `, ["Тестовое зачарование", "Зачарование теней"], ["Пример руны", "Другая руна"]],
  ];

  for (const [locale, body, expectedItems, expectedRunes] of examples) {
    const changes = parseChanges("9.0", locale, body);
    const items = changes.filter(({ entityKind }) => entityKind === "item");
    const runes = changes.filter(({ entityKind }) => entityKind === "rune");
    assert.deepEqual(items.map(({ entityName }) => entityName), expectedItems, `${locale}: wrapper text should not become part of an item identity`);
    assert.deepEqual(items.map(({ changeName }) => changeName), ["new", "removed"], `${locale}: prefix and suffix status markers should remain semantic changes`);
    assert.deepEqual(runes.map(({ entityName }) => entityName), expectedRunes, `${locale}: rune tree labels should not become part of a rune identity`);
  }
});

test("resolves an item replacement heading to its destination item in either locale", () => {
  const bootsOfFuror = { slug: "boots-of-furor", name: "Boots of Furor" };
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["boots of furor", bootsOfFuror],
      ["ботинки ярости", bootsOfFuror],
      ["boots of swiftness", { slug: "boots-of-swiftness", name: "Boots of Swiftness" }],
      ["ботинки стремительности", { slug: "boots-of-swiftness", name: "Boots of Swiftness" }],
    ]),
  };
  const inputs = [
    ["en-us", "Boots of Swiftness → Boots of Furor", "boots-of-furor", "Boots of Furor"],
    ["ru-ru", "Ботинки стремительности → Ботинки ярости", "boots-of-furor", "Ботинки ярости"],
  ];

  for (const [locale, heading, slug, name] of inputs) {
    const [change] = parseChanges("3.3", locale, `<h2>ITEMS</h2><h3>${heading}</h3><p>Movement speed was adjusted.</p>`, catalog);
    assert.equal(change.entityKind, "item");
    assert.equal(change.entitySlug, slug);
    assert.equal(change.entityName, name);
    assert.ok(change.details.some(({ text }) => /→/.test(text)), "the source transition remains visible in the details");
  }
});

test("keeps nested plural item headings as sections instead of fake item rows", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["cloak of agility", { slug: "cloak-of-agility", name: "Cloak of Agility" }],
      ["phantom dancer", { slug: "phantom-dancer", name: "Phantom Dancer" }],
    ]),
  };
  const changes = parseChanges("0.5", "en-us", `
    <h2>ITEMS</h2>
    <h3>CRITICAL STRIKE ITEMS</h3>
    <p>Critical strike items were adjusted.</p>
    <h4>CLOAK OF AGILITY</h4>
    <ul><li>Upgrade Cost: 300 → 500</li></ul>
    <h4>PHANTOM DANCER</h4>
    <ul><li>Total Cost: 2600G → 2800G</li></ul>
  `, catalog);
  const items = changes.filter(({ entityKind }) => entityKind === "item");

  assert.deepEqual(items.map(({ entitySlug }) => entitySlug), ["cloak-of-agility", "phantom-dancer"]);
  assert.ok(items.every(({ sectionName }) => sectionName === "CRITICAL STRIKE ITEMS"));
  assert.equal(items.some(({ entityName }) => entityName === "CRITICAL STRIKE ITEMS"), false);
});

test("recognizes patch-note cards by their title and URL when Riot omits the tag", () => {
  const patchCard = (version, locale, publishedAt, tagged = true) => ({
    ...(tagged ? { tags: [{ machineName: "patch_notes" }] } : {}),
    action: { payload: { url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-${version.replace(".", "-")}/` } },
    title: locale === "en-us" ? `Wild Rift Patch Notes ${version}` : `Описание обновления ${version} для Wild Rift`,
    publishedAt,
  });
  for (const [locale, title] of [
    ["en-us", "Wild Rift Patch Notes 7.0b"],
    ["ru-ru", "Описание обновления 7.0b для Wild Rift"],
  ]) {
    const page = { blades: [{ type: "articleCardGrid", items: [
      patchCard("7.0c", locale, "2026-02-10T10:00:00.000Z"),
      patchCard("7.0b", locale, "2026-02-03T10:00:00.000Z", false),
      patchCard("7.0a", locale, "2026-01-28T10:00:00.000Z"),
    ] }] };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { page } },
    })}</script>`;
    const results = parsePatchIndex(html, locale);
    assert.deepEqual(results.map(({ version }) => version), ["7.0c", "7.0b", "7.0a"]);
    assert.equal(results[1].title, title);
    assert.equal(results[1].url, `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-7-0b/`);
    assert.equal(results[1].publishedAt, "2026-02-03T10:00:00.000Z");
    assert.equal(results[1].imageUrl, null);
    assert.equal(results[1].description, "");
  }
  const emptyIndex = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page: { blades: [{ type: "articleCardGrid", items: [] }] } } },
  })}</script>`;
  assert.throws(() => parsePatchIndex(emptyIndex, "en-us"), /no valid patch-note cards/);
});

test("records Norra as the only non-mode entity in patch 7.0b", () => {
  const bodies = [
    ["en-us", `<h2>NEW CHAMPION</h2><h3>NORRA, THE PORTAL MISTRESS</h3><p>Norra will be released on February 4 at 00:01 UTC.</p>
      <h2>GAME MODE CHANGES</h2><h3>Arena</h3><h4>Item Adjustments</h4><h5>Manamune/Winter's Approach/Archangel's Staff</h5><ul><li>Mana: 30/36/45 → 100</li></ul>`],
    ["ru-ru", `<h2>НОВЫЙ ЧЕМПИОН</h2><h3>ПОВЕЛИТЕЛЬНИЦА ПОРТАЛОВ</h3><p>Йордл Норра, Повелительница порталов, – чародейка. Норра мечтает вернуться домой вместе с кошечкой Юми.</p>
      <h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2><h3>Арена</h3><h4>Изменения предметов</h4><h5>Манамунэ / Вестник зимы / Посох архангела</h5><ul><li>Мана: 30/36/45 → 100</li></ul>`],
  ];

  for (const [locale, body] of bodies) {
    const page = {
      url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-7-0b/`,
      blades: [
        { type: "articleMasthead", title: locale === "en-us" ? "Wild Rift Patch Notes 7.0b" : "Описание обновления 7.0b для Wild Rift", publishDate: "2026-02-03T10:00:00.000Z" },
        { type: "articleRichText", fragmentId: "NEW CHAMPION", richText: { body } },
      ],
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
    const norraCatalog = {
      ...emptyCatalog,
      champions: new Map([
        ["norra", { slug: "norra", name: "Norra", aliases: ["Norra", "Норра"] }],
        ["норра", { slug: "norra", name: "Norra", aliases: ["Norra", "Норра"] }],
      ]),
    };
    const { changes } = parsePatchArticle(html, "7.0b", locale, norraCatalog);

    const nonModeChanges = changes.filter((change) => change.scope?.type !== "game-mode");
    const arenaChanges = changes.filter((change) => change.scope?.type === "game-mode");
    assert.equal(nonModeChanges.length, 1, `${locale}: ${changes.map(({ entityKind, entityName }) => `${entityKind}:${entityName}`).join(", ")}`);
    assert.equal(nonModeChanges[0].entityKind, "champion");
    assert.equal(nonModeChanges[0].entitySlug, "norra");
    assert.equal(nonModeChanges[0].entityName, locale === "en-us" ? "Norra" : "Норра");
    assert.equal(nonModeChanges[0].changeName, "new");
    assert.equal(arenaChanges.length, 1);
    assert.deepEqual(arenaChanges[0].scope.modeSlugs, ["arena"]);
    const parsed = parsePatchArticle(html, "7.0b", locale, emptyCatalog);
    assert.equal(parsed.publishedAt, "2026-02-03T10:00:00.000Z");
    assert.equal(parsed.effectiveDate, null);
    assert.equal(parsed.effectiveRegion, null);
    assert.equal(parsed.effectiveDateSourceUrl, null);
  }
});

test("marks catalog champions as new from a Riot New Champions section", () => {
  const champions = new Map([
    ["zorblax", { slug: "zorblax", name: "Zorblax", aliases: ["Zorblax"] }],
  ]);
  const changes = parseChanges("7.3", "en-us", `<h2>NEW CHAMPIONS</h2>
    <h3>Zorblax, the Example</h3><p>Zorblax joins the Rift.</p>`, {
    ...emptyCatalog,
    champions,
  });
  const debut = changes.find(({ entitySlug }) => entitySlug === "zorblax");

  assert.ok(debut);
  assert.equal(debut.entityName, "Zorblax");
  assert.equal(debut.changeName, "new");
});

test("classifies uncatalogued entities from new-object sections without patch-specific rules", () => {
  const cases = [
    ["en-us", ["CHAMPIONS ADDED", "ITEMS ADDED", "NEW RUNES", "NEW SUMMONER SPELLS"], [
      ["champion", "Zorblax"], ["item", "Prismatic Resolver"], ["rune", "Afterglow"], ["spell", "Phase Shift"],
    ]],
    ["ru-ru", ["ДОБАВЛЕННЫЕ ЧЕМПИОНЫ", "ПРЕДМЕТЫ ДОБАВЛЕНЫ", "НОВЫЕ РУНЫ", "НОВЫЕ ЗАКЛИНАНИЯ"], [
      ["champion", "Зорблакс"], ["item", "Призматический резолвер"], ["rune", "Послесвечение"], ["spell", "Фазовый сдвиг"],
    ]],
  ];

  for (const [locale, headings, entities] of cases) {
    const body = entities.map(([kind, name], index) => (
      `<h2>${headings[index]}</h2><h3>${name}${kind === "champion" ? locale === "en-us" ? ", the Example" : ", Пример" : ""}</h3>`
    )).join("");
    const changes = parseChanges("9.0", locale, body);

    for (const [kind, name] of entities) {
      const change = changes.find((entry) => entry.entityKind === kind && entry.entityName === name);
      assert.ok(change, `${locale}: missing ${kind} ${name}`);
      assert.equal(change.changeName, "new", `${locale}: ${kind} ${name} was not marked new`);
    }
  }
});

test("limits section change markers to entity headings and supports suffix skin and summoner-spell sections", () => {
  const body = `
    <h2>NEW CHAMPIONS</h2><h3>Zorblax, the Example</h3><h4>Annie</h4><p>Nested champion text.</p><h5>Passive</h5>
    <h2>SUMMONER SPELLS ADDED</h2><h3>Phase Shift</h3><h4>Flash</h4><p>Nested spell text.</p>
    <h2>NEW RUNES</h2><h3>Afterglow</h3><h4>Fleet Footwork</h4><p>Nested rune text.</p>
    <h2>SKINS ADDED</h2><h3>Solar Guardian</h3><h4>Availability</h4><p>Nested skin text.</p>
  `;
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["annie", { slug: "annie", name: "Annie" }]]),
    spells: new Map([["flash", { slug: "flash", name: "Flash" }]]),
    runes: new Map([["fleet footwork", { slug: "fleet-footwork", name: "Fleet Footwork" }]]),
  };
  const changes = parseChanges("9.0", "en-us", body, catalog);

  assert.ok(changes.some((entry) => entry.entityKind === "champion" && entry.entityName === "Zorblax" && entry.changeName === "new"));
  assert.ok(changes.some((entry) => entry.entityKind === "spell" && entry.entityName === "Phase Shift" && entry.changeName === "new"));
  assert.ok(changes.some((entry) => entry.entityKind === "skin" && entry.entityName === "Solar Guardian" && entry.changeName === "new"));
  assert.equal(changes.some((entry) => ["Annie", "Passive", "Flash", "Fleet Footwork", "Availability"].includes(entry.entityName)), false);
});

test("keeps nested headings under a restored system section as components", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>Arena</h3>
    <h4>Summoner's Rift</h4><h5>Jungle</h5><p>Jungle system detail.</p>
  `, emptyCatalog, "");

  assert.equal(changes.some((entry) => entry.entityName === "Jungle" && entry.scope?.type !== "game-mode"), false);
  assert.equal(changes.some((entry) => entry.scope?.type === "game-mode"), true);
});

test("captures standalone numeric change prose under rune headings in both locales", () => {
  const rune = { slug: "fleet-footwork", name: "Fleet Footwork" };
  const catalog = {
    ...emptyCatalog,
    runes: new Map([["fleet footwork", rune]]),
  };
  const cases = [
    ["en-us", "RUNES", "Healing effectiveness: Against minions, the healing effectiveness for ranged champions is reduced to 30%."],
    ["ru-ru", "РУНЫ", "Эффективность лечения по миньонам для чемпионов дальнего боя снижена до 30%."],
  ];

  for (const [locale, category, effect] of cases) {
    const changes = parseChanges("1.1", locale, `
      <h3>${category}</h3><h4>Fleet Footwork</h4>
      <p>Context explaining why the rune is being adjusted.</p>
      <p>${effect}</p>
      <h2>OTHER NOTES</h2>
    `, catalog, "");
    const runeChange = changes.find(({ entityKind, entitySlug }) => entityKind === "rune" && entitySlug === rune.slug);

    assert.ok(runeChange, `${locale}: the rune change should remain a structured row`);
    assert.deepEqual(runeChange.details.map(({ text }) => text), [effect],
      `${locale}: capture the standalone numeric effect without treating its rationale as a stat`);
  }
});

test("does not parse correction of Morgana's skin availability as a new skin in 7.0a", () => {
  const champions = new Map([
    ["morgana", { slug: "morgana", name: "Morgana", aliases: ["Morgana", "Моргана"] }],
  ]);
  const corrections = [
    ["en-us", `<h2>LEGENDARY COLLECTION</h2><p>There is currently a bug where within the Legendary Collection system shows that Lunar Empress Morgana Exquisite Edition only has 10 days left, however the skin will be available until April 7.</p>`],
    ["ru-ru", `<h2>КОЛЛЕКЦИОННЫЕ ЛЕГЕНДЫ</h2><p>В данный момент в Коллекционных легендах присутствует ошибка. Информация о том, что образ "Лунная императрица Моргана (изысканное издание)" доступен всего 10 дней, – неверна. На самом деле образ будет доступен до 7 апреля.</p>`],
  ];

  for (const [locale, body] of corrections) {
    assert.equal(parseChanges("7.0a", locale, body, { ...emptyCatalog, champions })
      .some((change) => change.entityKind === "skin"), false);
  }
});

test("does not treat existing skins named in Russian client text bugs as patch availability", () => {
  const champions = new Map([
    ["lux", { slug: "lux", name: "Lux", aliases: ["Lux", "Люкс"] }],
    ["fizz", { slug: "fizz", name: "Fizz", aliases: ["Fizz", "Физз"] }],
  ]);
  const body = `<h2>ИЗВЕСТНЫЕ ОШИБКИ</h2><ul>
    <li>Названия образов некоторых чемпионов, например «Люкс, похитительница магии», некорректно переносятся на новую строку.</li>
    <li>Название образа «Супергалактический Физз» некорректно переносится на новую строку.</li>
  </ul>`;

  const changes = parseChanges("1.1", "ru-ru", body, { ...emptyCatalog, champions });

  assert.equal(changes.some((change) => change.entityKind === "skin"), false);
});

test("keeps the source change type and classifies catalog items from article sections", () => {
  for (const [locale, name] of [["en-us", "Ziggs"], ["ru-ru", "Зиггс"]]) {
    const championBody = `<h2>${locale === "en-us" ? "CHAMPION CHANGES" : "ИЗМЕНЕНИЯ ЧЕМПИОНОВ"}</h2>
      <h3>${name}</h3><h4>${locale === "en-us" ? "Nerf" : "Ослабление"}</h4><ul>
      <li>${locale === "en-us" ? "Ability Power ratio: 25% → 15%" : "Коэффициент силы умений: 25% → 15%"}</li>
      <li>${locale === "en-us" ? "Cooldown: 6s → 5s" : "Перезарядка: 6 сек. → 5 сек."}</li></ul>`;
    const changes = parseChanges("7.1", locale, championBody, {
      ...emptyCatalog,
      champions: new Map([[name.toLowerCase(), { slug: "ziggs", name, aliases: [name] }]]),
    });
    assert.equal(changes.find(({ entityKind, entityName }) => entityKind === "champion" && entityName === name)?.changeName,
      locale === "ru-ru" ? "Ослабление" : "Nerf");

    const itemName = locale === "en-us" ? "Lord Dominik's Regards" : "Поклон лорда Доминика";
    const items = parseChanges("9.0", locale, `<h2>${locale === "en-us" ? "NEW ITEMS" : "НОВЫЕ ПРЕДМЕТЫ"}</h2>
      <h3>${itemName}</h3>`, {
      ...emptyCatalog,
      items: new Map([[locale === "en-us" ? "lord dominik s regards" : "поклон лорда доминика", {
        slug: "lord-dominiks-regards", name: "Lord Dominik's Regards", aliases: ["Lord Dominik's Regards", "Поклон лорда Доминика"],
      }]]),
    });
    const lordDominik = items.find(({ entitySlug }) => entitySlug === "lord-dominiks-regards");
    assert.ok(lordDominik);
    assert.equal(lordDominik.changeName, "new");
    assert.equal(lordDominik.entityName, locale === "en-us" ? "Lord Dominik's Regards" : "Поклон лорда Доминика");
  }
});

test("parses non-mode bug fixes as structured English system details", () => {
  const changes = parseChanges("7.0d", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><ul><li>Mode-only change.</li></ul>
    <h2>BUG FIXES</h2><ul>
      <li>Fixed an issue with Navori Quickblades' description.</li>
      <li>Fixed an issue where Hullbreaker kept buffing minions after its owner died.</li>
    </ul>
  `);

  const bugFixes = changes.find(({ sectionName }) => sectionName === "BUG FIXES");
  assert.ok(bugFixes);
  assert.equal(bugFixes.entityKind, "system");
  assert.deepEqual(bugFixes.details.map(({ text }) => text), [
    "Fixed an issue with Navori Quickblades' description.",
    "Fixed an issue where Hullbreaker kept buffing minions after its owner died.",
  ]);
});

test("uses Riot's standalone bug-fix fragment when its body has no category heading", () => {
  const article = articleHtml("6.2i", "en-us", `
    <h3>Bug Fix</h3><ul>
      <li>Fixed an issue where Piercing Feathers could infinitely trigger under certain conditions.</li>
    </ul>
  `, "bug-fixes");
  const changes = parsePatchArticle(article, "6.2i", "en-us", emptyCatalog).changes;
  const bugFix = changes.find(({ entityKind }) => entityKind === "system");

  assert.ok(bugFix);
  assert.deepEqual(bugFix.details.map(({ text }) => text), [
    "Fixed an issue where Piercing Feathers could infinitely trigger under certain conditions.",
  ]);
});

test("preserves Russian bug-fix text and ignores game-mode fixes", () => {
  const changes = parseChanges("7.0d", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2><h3>АРЕНА</h3><ul><li>Исправлена ошибка режима.</li></ul>
    <h2>ИСПРАВЛЕНИЕ ОШИБОК</h2><ul>
      <li>Исправлена ошибка, из-за которой эффект контроля нельзя было снять.</li>
    </ul>
  `);

  const bugFixes = changes.find(({ sectionName }) => sectionName === "ИСПРАВЛЕНИЕ ОШИБОК");
  assert.ok(bugFixes);
  assert.equal(bugFixes.entityKind, "system");
  assert.deepEqual(bugFixes.details.map(({ text }) => text), [
    "Исправлена ошибка, из-за которой эффект контроля нельзя было снять.",
  ]);
});

test("uses English skin section and fallback text for announcement skins", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([[
      "taliyah",
      { slug: "taliyah", name: "Taliyah", aliases: ["Taliyah"] },
    ]]),
  };
  const [skin] = parseChanges("7.1e", "en-us", `
    <h2>SKINS</h2><h3>New Skins</h3><p>Pool Party Taliyah</p>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");

  assert.equal(skin.entityName, "Pool Party Taliyah");
  assert.equal(skin.sectionName, "SKINS");
  assert.equal(skin.details[0].text, "Skin available in this patch.");
});

test("uses English skin fallback text for English listed skins", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([[
      "taliyah",
      { slug: "taliyah", name: "Taliyah", aliases: ["Taliyah"] },
    ]]),
  };
  const [skin] = parseChanges("7.1g", "en-us", `
    <h2>SKINS</h2><p>Plant Protector Sion</p>
  `, {
    ...catalog,
    champions: new Map([[
      "sion",
      { slug: "sion", name: "Sion", aliases: ["Sion"] },
    ]]),
  }).filter(({ entityKind }) => entityKind === "skin");

  assert.equal(skin.sectionName, "SKINS");
  assert.equal(skin.details[0].text, "Skin available in this patch.");
});

test("captures Skarner's patch 7.3 durability changes in EN and RU", () => {
  const inputs = [
    ["en-us", "<h2>CHAMPION CHANGES</h2><h4>Skarner</h4><p><i>Base Stats</i></p><ul><li>Base Health: 690 → 660</li><li>Health per Level: 128 → 132</li></ul>"],
    ["ru-ru", "<h2>ИЗМЕНЕНИЯ ЧЕМПИОНОВ</h2><h4>Скарнер</h4><p><i>Основные показатели</i></p><ul><li>Базовый запас здоровья: 690 → 660</li><li>Прирост здоровья: 128 → 132</li></ul>"],
  ];
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["skarner", { slug: "skarner", name: "Skarner", aliases: ["Skarner", "Скарнер"] }],
      ["скарнер", { slug: "skarner", name: "Skarner", aliases: ["Skarner", "Скарнер"] }],
    ]),
  };
  for (const [locale, body] of inputs) {
    const skarner = parseChanges("7.3", locale, body, catalog).find((change) => change.entityKind === "champion" && change.entitySlug === "skarner");
    assert.ok(skarner);
    assert.deepEqual(skarner.details.map(({ before, after }) => [before, after]), [["690", "660"], ["128", "132"]]);
  }
});

test("recovers catalog champion stat headings in arbitrary future patches", () => {
  const inputs = [
    ["en-us", "Zorblax", "Base Health: 690 → 660", "Health per Level: 128 → 132"],
    ["ru-ru", "Зорблакс", "Базовый запас здоровья: 690 → 660", "Прирост здоровья: 128 → 132"],
  ];
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["zorblax", { slug: "zorblax", name: "Zorblax", aliases: ["Zorblax", "Зорблакс"] }],
      ["зорблакс", { slug: "zorblax", name: "Zorblax", aliases: ["Zorblax", "Зорблакс"] }],
    ]),
  };
  for (const [locale, name, health, growth] of inputs) {
    const change = parseChanges("9.0", locale, `<h2>${locale === "en-us" ? "CHAMPION CHANGES" : "ИЗМЕНЕНИЯ ЧЕМПИОНОВ"}</h2>
      <h4>${name}</h4><p>${locale === "en-us" ? "Base Stats" : "Основные показатели"}</p>
      <ul><li>${health}</li><li>${growth}</li></ul>`, catalog)
      .find((entry) => entry.entityKind === "champion" && entry.entitySlug === "zorblax");
    assert.ok(change, `${locale}: missing recovered champion stats`);
    assert.deepEqual(change.details.map(({ before, after }) => [before, after]), [["690", "660"], ["128", "132"]]);
  }
});

test("keeps nested component labels in the champion-stat fallback walker", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["zorblax", { slug: "zorblax", name: "Zorblax", aliases: ["Zorblax"] }]]),
  };
  const change = parseChanges("9.0", "en-us", `
    <h3>Zorblax</h3><h4>Base Stats</h4><ul><li>Base Health: 690 → 660</li></ul>
    <h4>Passive</h4><ul><li>Damage: 10 → 12</li></ul>
  `, catalog, "champion-stat-adjustments").find((entry) => entry.entityKind === "champion");

  assert.ok(change);
  assert.deepEqual(change.details.map(({ text, component }) => [text, component]), [
    ["Base Health: 690 → 660", "Base Stats"],
    ["Damage: 10 → 12", "Passive"],
  ]);
});

test("keeps champion stat recovery inside champion sections and merges missing details", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["zorblax", { slug: "zorblax", name: "Zorblax", aliases: ["Zorblax"] }]]),
  };
  const systemChange = parseChanges("9.0", "en-us", `
    <h2>GAMEPLAY SYSTEMS</h2><h3>Zorblax</h3><p>Base Stats</p>
    <ul><li>Base Health: 690 → 660</li></ul>
  `, catalog);
  assert.equal(systemChange.some((change) => change.entityKind === "champion" && change.entitySlug === "zorblax"), false);

  const championChanges = parseChanges("9.0", "en-us", `
    <h2>CHAMPION CHANGES</h2><h3>Zorblax</h3><ul><li>Damage: 10 → 20</li></ul>
    <h4>Zorblax</h4><p>Base Stats</p><ul><li>Base Health: 690 → 660</li></ul>
  `, catalog).filter((change) => change.entityKind === "champion" && change.entitySlug === "zorblax");
  assert.equal(championChanges.length, 1);
  assert.ok(championChanges[0].details.some(({ text }) => text === "Damage: 10 → 20"));
  assert.ok(championChanges[0].details.some(({ text }) => text === "Base Health: 690 → 660"));
});

test("classifies Dusk and Dawn as a nerf in both patch 7.3 locales", () => {
  const catalog = {
    ...emptyCatalog,
    champions: skinChampionCatalog.champions,
    items: new Map([
      ["dusk and dawn", { slug: "dusk-and-dawn", name: "Dusk and Dawn" }],
      ["рассвет и закат", { slug: "dusk-and-dawn", name: "Dusk and Dawn" }],
    ]),
  };
  const inputs = [
    ["en-us", "<h4>Dusk and Dawn</h4><p>Base Stats</p><ul><li>Ability Power: 70 → 60</li></ul>"],
    ["ru-ru", "<h4>Рассвет и закат</h4><p>Основные параметры</p><ul><li>Сила умений: 70 → 60</li></ul>"],
  ];
  for (const [locale, body] of inputs) {
    const item = parseChanges("9.0", locale, body, catalog).find((change) => change.entityKind === "item" && change.entitySlug === "dusk-and-dawn");
    assert.equal(item?.changeName, "nerf");
  }
});

test("recognizes declined Russian item power values as a nerf", () => {
  const nashorsTooth = { slug: "nashors-tooth", name: "Nashor's Tooth" };
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["nashor s tooth", nashorsTooth],
      ["зуб нашора", nashorsTooth],
    ]),
  };
  const changes = parseChanges("6.2k", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>ПРЕДМЕТЫ</h3><h4>Зуб Нашора</h4>
    <p>Зуб Нашора чересчур усиливал боевую мощь на ранней стадии игры. Мы решили ослабить его.</p>
    <p><em>Волшебный клык</em></p><ul><li>Дает прибавку в 30 ед. к силе атаки или в 60 ед. к силе умений (адаптивно) → Дает прибавку в 25 ед. к силе атаки или в 50 ед. к силе умений (адаптивно)</li></ul>
  `, catalog).find(({ entityKind, entitySlug }) => entityKind === "item" && entitySlug === "nashors-tooth");

  assert.equal(changes?.changeName, "nerf");
});

test("keeps italic Russian item component names attached to stat changes", () => {
  const items = [
    { slug: "nashors-tooth", name: "Nashor's Tooth", alias: "Зуб Нашора", component: "Волшебный клык" },
    { slug: "infinity-orb", name: "Infinity Orb", alias: "Сфера бесконечности", component: "Раскаты грома" },
    { slug: "seryldas-grudge", name: "Serylda's Grudge", alias: "Злоба Серильди", component: "Обморожение" },
  ];
  const catalog = {
    ...emptyCatalog,
    items: new Map(items.map((item) => [item.alias.toLowerCase(), item])),
  };
  const changes = parseChanges("9.0", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>ПРЕДМЕТЫ</h3>
    <h4>Зуб Нашора</h4><p>Пассивный эффект был слишком силен.</p>
    <p><em>Волшебный клык&nbsp;</em></p><ul><li>Сила атаки: 30 → 25</li></ul>
    <h4>Сфера бесконечности</h4><p>Урон был слишком высок.</p>
    <p><em>Раскаты грома</em></p><ul><li>Урон: 50–85 → 50–75</li></ul>
    <h4>Злоба Серильди</h4><p>Урон был слишком высок.</p>
    <p><em>Обморожение</em></p><ul><li>Урон: 25 → 10</li></ul>
  `, catalog);
  const rows = buildPatchChangeRows(changes, catalog, [], "9.0")
    .filter(({ entityKind }) => entityKind === "item");

  assert.deepEqual(rows.map(({ entitySlug }) => entitySlug), items.map(({ slug }) => slug));
  assert.deepEqual(rows.map(({ details }) => details
    .filter(({ before, after }) => before && after)
    .map(({ component }) => component)), items.map(({ component }) => [component]));
  assert.equal(changes.some(({ entityName }) => items.some(({ component }) => entityName === component)), false,
    "a passive title is component metadata, not a fake item entity");
});

test("splits multiple labeled champion deltas in one localized paragraph", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["janna", { slug: "janna", name: "Janna", nameLocalizations: { "ru-ru": "Жанна" }, aliases: ["Janna", "Жанна"] }],
      ["жанна", { slug: "janna", name: "Janna", nameLocalizations: { "ru-ru": "Жанна" }, aliases: ["Janna", "Жанна"] }],
    ]),
  };
  const changes = parseChanges("1.1", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ЧЕМПИОНОВ</h2><h3>Жанна</h3>
    <p>Жанна должна защищать союзников и наносить изнуряющий урон.</p>
    <h4>ОСНОВНЫЕ ПОКАЗАТЕЛИ</h4><p><em>Сила атаки:</em> 46 → 52.</p>
    <h4>(2) ЗАПАДНЫЙ ВЕТЕР</h4>
    <p><em>Урон:</em> 55/115/175/235 + 50% силы умений + 25% скорости передвижения → 65/125/185/245 + 60% силы умений + 25% скорости передвижения.</p>
    <h4>(3) ОКО БУРИ</h4>
    <p><em>Базовая прочность щита:</em> 80/130/180/230 → 90/140/190/240.
    Перезарядка: 16/14/12/10 секунд → 13/12/11/10 секунд.</p>
    <h3>ШИВАНА</h3>
  `, catalog);
  const janna = changes.find(({ entityKind, entitySlug }) => entityKind === "champion" && entitySlug === "janna");
  const deltas = janna?.details.filter(({ before, after }) => before && after);

  assert.equal(deltas?.length, 4);
  assert.deepEqual(deltas?.map(({ label, before, after }) => [label, before, after]), [
    ["Сила атаки", "46", "52."],
    ["Урон", "55/115/175/235 + 50% силы умений + 25% скорости передвижения", "65/125/185/245 + 60% силы умений + 25% скорости передвижения."],
    ["Базовая прочность щита", "80/130/180/230", "90/140/190/240."],
    ["Перезарядка", "16/14/12/10 секунд", "13/12/11/10 секунд."],
  ]);
});

test("scans deeply nested item adjustment sections without duplicating nested components", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([["prismatic resolver", { slug: "prismatic-resolver", name: "Prismatic Resolver" }]]),
  };
  const changes = parseChanges("9.0", "en-us", `
    <h2>GAMEPLAY UPDATES</h2><h3>ITEM ADJUSTMENTS</h3><h4>Prismatic Resolver</h4>
    <ul><li>Ability Power: 40 → 50</li><li>Cooldown: 10 → 8</li></ul>
    <h5>Passive</h5><ul><li>Damage: 20 → 25</li></ul>
    <h5>Uncatalogued Component</h5><ul><li>Attack Damage: 10 → 12</li></ul>
  `, catalog);
  const item = changes.find((change) => change.entitySlug === "prismatic-resolver");

  assert.ok(item);
  assert.equal(item.changeName, "buff");
  assert.equal(item.details.some(({ text }) => text === "Damage: 20 → 25"), true);
  assert.equal(changes.some((change) => change.entityName === "Uncatalogued Component"), false);
});

test("keeps a Build Patch delta on its item instead of assigning it to recipe components", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["unending despair", { slug: "unending-despair", name: "Unending Despair" }],
      ["chain vest", { slug: "chain-vest", name: "Chain Vest" }],
      ["negatron cloak", { slug: "negatron-cloak", name: "Negatron Cloak" }],
      ["ruby crystal", { slug: "ruby-crystal", name: "Ruby Crystal" }],
      ["kindlegem", { slug: "kindlegem", name: "Kindlegem" }],
    ]),
  };
  const changes = parseChanges("7.2e", "en-us", `
    <h2>ITEM ADJUSTMENTS</h2><h4>Unending Despair</h4><p>Base Stats</p>
    <ul>
      <li>Health: 200 → 300</li>
      <li>Build Patch: Chain Vest (900) + Negatron Cloak (900) + Ruby Crystal (500) + 700 → Chain Vest (900) + Negatron Cloak (900) + Kindlegem (1000) + 200</li>
    </ul>
  `, catalog);
  const itemRows = changes.filter(({ entityKind }) => entityKind === "item");

  assert.deepEqual(itemRows.map(({ entitySlug }) => entitySlug), ["unending-despair"]);
  assert.ok(itemRows[0].details.some(({ label, before, after }) => (
    label === "Build Patch" && before && after
  )));
});

test("keeps nested item-group labels as components and does not repeat child deltas", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["harmonic echo", { slug: "harmonic-echo", name: "Harmonic Echo" }],
      ["plated steelcaps", { slug: "plated-steelcaps", name: "Plated Steelcaps" }],
    ]),
  };
  const changes = parseChanges("4.3d", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>ITEMS</h3>
    <h4>Harmonic Echo</h4>
    <p>We are increasing the amount of healing and lowering the cost.</p>
    <ul>
      <li>Base stats:
        <ul><li>Cost: 2900g → <strong>2700g</strong></li></ul>
      </li>
      <li>Harmonic Echo:
        <ul><li>Healing amount: 70 + 10% Ability Power → <strong>130 + 10% Ability Power</strong></li></ul>
      </li>
    </ul>
    <h4>Plated Steelcaps</h4><p>Block:</p>
    <ul><li>Reduces physical damage by: 12% → <strong>10%</strong></li></ul>
  `, catalog);
  const bySlug = new Map(changes.filter(({ entityKind }) => entityKind === "item")
    .map((item) => [item.entitySlug, item]));
  const harmonicEcho = bySlug.get("harmonic-echo");
  const platedSteelcaps = bySlug.get("plated-steelcaps");

  assert.deepEqual(harmonicEcho.details.filter(({ before, after }) => before && after)
    .map(({ label, before, after, component }) => [label, before, after, component]), [
    ["Cost", "2900g", "2700g", "Base stats"],
    ["Healing amount", "70 + 10% Ability Power", "130 + 10% Ability Power", "Harmonic Echo"],
  ]);
  assert.equal(harmonicEcho.details.some(({ text }) => /^(?:Base stats|Harmonic Echo):/i.test(text)), false);
  assert.deepEqual(platedSteelcaps.details.filter(({ before, after }) => before && after)
    .map(({ label, before, after, component }) => [label, before, after, component]), [
    ["Reduces physical damage by", "12%", "10%", "Block"],
  ]);
  assert.equal(platedSteelcaps.details.some(({ text }) => /^Block:$/i.test(text)), false);
});

test("keeps paragraph-based item effect labels as components instead of pseudo-items", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["boots of dynamism", { slug: "boots-of-dynamism", name: "Boots of Dynamism" }],
      ["duskblade of draktharr", { slug: "duskblade-of-draktharr", name: "Duskblade of Draktharr" }],
      ["mercury s treads", { slug: "mercurys-treads", name: "Mercury's Treads" }],
    ]),
  };
  const parsed = parseChanges("4.3d", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>ITEMS</h3>
    <h4>Boots of Dynamism</h4><p>Base stats:</p><ul><li>Cost: 1500g → 1400g</li></ul>
    <p>Pounce:</p><ul><li>Armor penetration: 8 → 10</li></ul>
    <h4>Duskblade of Draktharr</h4><p>Razor:</p><ul><li>Armor penetration: 15 → 18</li></ul>
    <p>Nightstalker:</p><ul><li>Base damage: 20-125 → 60-160</li><li>Slowdown time: 0.25s → 0.35s</li></ul>
    <h4>Mercury's Treads</h4><p>Base stats:</p><ul><li>Maximum health: 150 → 200</li></ul>
    <p>Resolve:</p><ul><li>Reducing magic damage by: 15% → 12%</li></ul>
  `, catalog);
  const rows = buildPatchChangeRows(parsed, catalog, [], "4.3d");
  const items = rows.filter(({ entityKind }) => entityKind === "item");
  const bySlug = new Map(items.map((item) => [item.entitySlug, item]));

  assert.equal(items.length, 3);
  assert.equal(items.some(({ entityName }) => /^(?:Pounce|Razor|Nightstalker|Resolve):?$/i.test(entityName)), false);
  assert.deepEqual(bySlug.get("boots-of-dynamism")?.details.map(({ label, component }) => [label, component]), [
    ["Cost", "Base stats"],
    ["Armor penetration", "Pounce"],
  ]);
  assert.deepEqual(bySlug.get("duskblade-of-draktharr")?.details.map(({ label, component }) => [label, component]), [
    ["Armor penetration", "Razor"],
    ["Base damage", "Nightstalker"],
    ["Slowdown time", "Nightstalker"],
  ]);
  assert.deepEqual(bySlug.get("mercurys-treads")?.details.map(({ label, component }) => [label, component]), [
    ["Maximum health", "Base stats"],
    ["Reducing magic damage by", "Resolve"],
  ]);
});

test("keeps marker-prefixed English passives under their item instead of creating item rows", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([["boots of mana", { slug: "boots-of-mana", name: "Boots of Mana" }]]),
  };
  const parsed = parseChanges("6.1", "en-us", `
    <h3>ITEM CHANGES</h3>
    <h4>Boots of Mana</h4><p>[New] Big Bully:</p>
    <ul><li>Attacks and active abilities deal 18 bonus physical damage to minions.</li></ul>
  `, catalog);
  const items = buildPatchChangeRows(parsed, catalog, [], "6.1")
    .filter(({ entityKind }) => entityKind === "item");

  assert.equal(items.length, 1);
  assert.equal(items[0].entitySlug, "boots-of-mana");
  assert.deepEqual(items[0].details.map(({ text, component }) => [text, component]), [
    ["Attacks and active abilities deal 18 bonus physical damage to minions.", "Big Bully"],
  ]);
  assert.equal(items.some(({ entityName }) => entityName === "Big Bully"), false);
});

test("keeps Russian item passive labels inside the catalogued item", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["посох веков", { slug: "rod-of-ages", name: "Посох веков" }],
    ]),
  };
  const parsed = parseChanges("7.2", "ru-ru", `
    <h3>ПРЕДМЕТЫ</h3><h4>Посох веков</h4>
    <p>Основные характеристики:</p><ul><li>Мана: 300 → 400</li></ul>
    <p>Ветеран</p><ul><li>Максимальное здоровье: 100 → 150</li></ul>
  `, catalog);
  const items = buildPatchChangeRows(parsed, catalog, [], "7.2")
    .filter(({ entityKind }) => entityKind === "item");

  assert.equal(items.length, 1);
  assert.equal(items[0].entitySlug, "rod-of-ages");
  assert.deepEqual(items[0].details.filter(({ component }) => component).map(({ label, component }) => [label, component]), [
    ["Мана", "Основные характеристики"],
    ["Максимальное здоровье", "Ветеран"],
  ]);
});

test("does not resolve a longer Russian item heading to a shorter catalog alias", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["завеса", { slug: "veil-enchant", name: "Veil Enchant" }],
      ["зачарование завесы", { slug: "veil-enchant", name: "Veil Enchant" }],
    ]),
  };
  const parsed = parseChanges("7.2", "ru-ru", `
    <h3>ПРЕДМЕТЫ</h3>
    <h4>Зачарование завесы</h4><ul><li>Стоимость: 100 → 200</li></ul>
    <h4>Завеса банши</h4><p>Мы объединили эффект предмета.</p>
    <p>Основные параметры</p><ul><li>Стоимость: 3000 → 2900</li></ul>
  `, catalog);
  const items = buildPatchChangeRows(parsed, catalog, [], "7.2")
    .filter(({ entityKind }) => entityKind === "item");

  assert.equal(items.length, 2);
  assert.equal(items.find(({ entitySlug }) => entitySlug === "veil-enchant")?.entityName, "Зачарование завесы");
  assert.equal(items.some(({ entityName }) => entityName === "Завеса"), false);
  assert.equal(items.find(({ entityName }) => entityName === "Завеса банши")?.entitySlug, null);
});

test("does not infer an item buff or nerf from cooldown direction alone", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>ITEM ADJUSTMENTS</h2><h3>Prismatic Resolver</h3>
    <ul><li>Cooldown: 10 → 8</li></ul>
  `, {
    ...emptyCatalog,
    items: new Map([["prismatic resolver", { slug: "prismatic-resolver", name: "Prismatic Resolver" }]]),
  });

  assert.equal(changes.find((change) => change.entitySlug === "prismatic-resolver")?.changeName, "adjustment");
});

test("supports h4 item sections, nested catalog items, and ambiguous stat directions", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["prismatic resolver", { slug: "prismatic-resolver", name: "Prismatic Resolver" }],
      ["starlit core", { slug: "starlit-core", name: "Starlit Core" }],
    ]),
  };
  const changes = parseChanges("9.0", "en-us", `
    <h2>GAMEPLAY UPDATES</h2><h3>ITEM ADJUSTMENTS</h3>
    <h4>Prismatic Resolver</h4><ul><li>Ability Power: 40 → 50</li></ul>
    <h5>Starlit Core</h5><ul><li>Cooldown: 10 → 8</li></ul>
    <h4>OTHER ITEMS</h4><h5>Starlit Core</h5><ul><li>Health: 100 → 120</li></ul>
  `, catalog);
  const parent = changes.find((change) => change.entitySlug === "prismatic-resolver");
  const child = changes.find((change) => change.entitySlug === "starlit-core");

  assert.ok(parent, "h5 item under an h4 item category is recovered");
  assert.ok(child, "a nested catalog item is not discarded as a component");
  assert.equal(parent.changeName, "buff");
  assert.equal(child.changeName, "adjustment");

  const ambiguous = parseChanges("9.0", "en-us", `
    <h2>ITEM ADJUSTMENTS</h2><h3>Prismatic Resolver</h3>
    <ul><li>Ability Power: 40 → 50</li><li>Cooldown: 10 → 12</li></ul>
  `, catalog).find((change) => change.entitySlug === "prismatic-resolver");
  assert.equal(ambiguous?.changeName, "adjustment");
});

test("extracts labels from compact numeric deltas without a colon", () => {
  const champion = { slug: "test-champion", name: "Test Champion" };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["test champion", champion], ["test-champion", champion]]),
  };
  const parsed = parsePatchArticle(articleHtml("9.9", "en-us", `
    <h2>CHAMPION CHANGES</h2><h3>Test Champion</h3><h4>BASE STATS</h4>
    <ul><li>Attack Damage 60 → 62</li><li>Cooldown 10s -> 8s</li></ul>
  `), "9.9", "en-us", catalog);
  const row = parsed.changes.find(({ entityKind, entitySlug }) => entityKind === "champion" && entitySlug === "test-champion");

  assert.deepEqual(row?.details.map(({ label, before, after }) => [label, before, after]), [
    ["Attack Damage", "60", "62"],
    ["Cooldown", "10s", "8s"],
  ]);
});

test("keeps a specific item heading when the catalog also contains nested generic aliases", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["youmuu s ghostblade", { slug: "youmuus-ghostblade", name: "Youmuu's Ghostblade" }],
      ["locket", { slug: "locket", name: "Locket" }],
      ["locket enchant", { slug: "locket-enchant", name: "Locket Enchant" }],
      ["locket of the iron solari", { slug: "locket-of-the-iron-solari", name: "Locket of the Iron Solari" }],
      ["thornmail", { slug: "thornmail", name: "Thornmail" }],
      ["warmog s armor", { slug: "warmogs-armor", name: "Warmog's Armor" }],
      ["warmog s heart", { slug: "warmogs-armor", name: "Warmog's Armor" }],
      ["statikk shiv", { slug: "statikk-shiv", name: "Statikk Shiv" }],
      ["yun tal wildarrows", { slug: "yun-tal-wildarrows", name: "Yun Tal Wildarrows" }],
    ]),
  };
  const items = parseChanges("7.3b", "en-us", riot73bItemAdjustments, catalog).filter((change) => change.entityKind === "item");

  assert.deepEqual(items.map(({ entitySlug }) => entitySlug), [
    "youmuus-ghostblade",
    "locket-of-the-iron-solari",
    "thornmail",
    "warmogs-armor",
    "statikk-shiv",
    "yun-tal-wildarrows",
  ]);
  const locket = items.find(({ entitySlug }) => entitySlug === "locket-of-the-iron-solari");
  assert.deepEqual(locket.details.filter(({ before, after }) => before && after).map(({ text }) => text), [
    "Price: 2600 → 2500",
    "Health: 200 → 300",
  ]);
});

test("starts a new item at a deeper heading instead of folding it into the previous item", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["youmuu s ghostblade", { slug: "youmuus-ghostblade", name: "Youmuu's Ghostblade" }],
      ["locket of the iron solari", { slug: "locket-enchant", name: "Locket of the Iron Solari" }],
      ["statikk shiv", { slug: "statikk-shiv", name: "Statikk Shiv" }],
      ["yun tal wildarrows", { slug: "yun-tal-wildarrows", name: "Yun Tal Wildarrows" }],
    ]),
  };
  const changes = parseChanges("9.0", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h2>Items</h2>
    <h4>Youmuu's Ghostblade</h4><p>Base Stats</p><ul><li>Price: 3000 → 2900</li></ul>
    <h4>Locket of the Iron Solari</h4><p>Base Stats</p><ul><li>Price: 2600 → 2500</li><li>Health: 200 → 300</li></ul>
    <h4>Statikk Shiv</h4><p>Base Stats</p><ul><li>Price: 3000 → 2900</li></ul>
    <h4>Yun Tal Wildarrows</h4><p>Base Stats</p><ul><li>Price: 3100 → 3000</li></ul>
  `, catalog).filter((change) => change.entityKind === "item");

  assert.deepEqual(changes.map(({ entitySlug, details }) => [entitySlug, details.map(({ text }) => text)]), [
    ["youmuus-ghostblade", ["Price: 3000 → 2900"]],
    ["locket-enchant", ["Price: 2600 → 2500", "Health: 200 → 300"]],
    ["statikk-shiv", ["Price: 3000 → 2900"]],
    ["yun-tal-wildarrows", ["Price: 3100 → 3000"]],
  ]);
});

test("classifies Sivir's mixed 7.3 champion changes as an adjustment in both locales", () => {
  const inputs = [
    ["en-us", "Sivir", "Base Stats", [
      "Base Attack Damage: 58 → 60",
      "Attack Speed Ratio: 0.625",
      "Base Attack Speed: 0.625",
      "Base Bonus Attack Speed: 0.3",
      "Attack Speed per Level: 0.01",
      "Movement Speed bonus: 31 - 45 (based on level) → 55 - 70 (based on level)",
      "Damage: 10 / 30 / 50 / 70 + 75 / 80 / 85 / 90% Attack Damage + 60% Ability Power × 50% × Critical Rate → (70 / 100 / 130 / 160 + 70% × bonus Attack Damage + 60% Ability Power) × (1 + Critical Rate × 40% + (Critical Damage-2) × 40% × Critical Rate)",
      "Non-champion damage ratio: 80% → 75%",
      "Damage: 4 / 6 / 8 / 10 + 15 / 18 / 21 / 24% Attack Damage → 37.5% / 40% / 42.5% / 45% Attack Damage",
      "Minion ratio: 75% → 70%",
      "Initial Movement Speed bonus: 15% → 15 / 20 / 25%",
      "Initial Movement Speed duration: 10 / 11 / 12 seconds → 8 / 10 / 12 seconds",
      "Cooldown reduction ratio: 30 / 35 / 40% → 20 / 25 / 30%",
      "Attack Damage per morale stack: 2 / 3 / 4 → 2 / 2.5 / 3",
      "Re-triggering refreshes Hunt duration.",
      "Movement Speed granted on re-trigger: 25% → 15 / 20 / 25%",
    ]],
    ["ru-ru", "Сивир", "Основные показатели", [
      "Базовая сила атаки: 58 → 60",
      "Коэффициент скорости атаки: 0,625",
      "Базовая скорость атаки: 0,625",
      "Базовая дополнительная скорость атаки: 0,3",
      "Прирост скорости атаки: 0,01",
      "Бонус к скорости передвижения: 31–45 (в зависимости от уровня) → 55–70 (в зависимости от уровня)",
      "Урон: 10 / 30 / 50 / 70 + 75 / 80 / 85 / 90% от силы атаки + 60% от силы умений × 50% × шанс критического удара → (70 / 100 / 130 / 160 + 70% × дополнительная сила атаки + 60% от силы умений) × (1 + шанс критического удара × 40% + (критический урон – 2) × 40% × шанс критического удара)",
      "Коэффициент урона целям, которые не являются чемпионами: 80% → 75%",
      "Урон: 4 / 6 / 8 / 10 + 15 / 18 / 21 / 24% от силы атаки → 37,5% / 40% / 42,5% / 45% от силы атаки",
      "Коэффициент урона миньонам: 75% → 70%",
      "Изначальный бонус к скорости передвижения: 15% → 15 / 20 / 25%",
      "Изначальная продолжительность скорости передвижения: 10 / 11 / 12 сек. → 8 / 10 / 12 сек.",
      "Коэффициент сокращения перезарядки: 30 / 35 / 40% → 20 / 25 / 30%",
      "Сила атаки за каждый заряд Боевого духа: 2 / 3 / 4 → 2 / 2,5 / 3",
      "Повторное применение обновляет продолжительность Охоты.",
      "Скорость передвижения при повторном применении: 25% → 15 / 20 / 25%",
    ]],
  ];
  const sivir = { slug: "sivir", name: "Sivir", aliases: ["Sivir", "Сивир"] };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["sivir", sivir], ["сивир", sivir]]),
  };
  for (const [locale, championName, statsLabel, details] of inputs) {
    const sivirRow = parseChanges("7.3", locale, `
      <h2>${locale === "ru-ru" ? "ИЗМЕНЕНИЯ ЧЕМПИОНОВ" : "CHAMPION CHANGES"}</h2>
      <h3>${championName}</h3><p>${statsLabel}</p>
      <ul>${details.map((detail) => `<li>${detail}</li>`).join("")}</ul>
    `, catalog).find((change) => change.entityKind === "champion" && change.entityName === championName);
    assert.ok(sivirRow, `${locale}: expected the Sivir champion row`);
    assert.equal(sivirRow.details.length, 16, locale);
    assert.equal(sivirRow.changeName, "adjustment", locale);
  }
});

test("parses 7.3 Smite adjustments as the same localized spell in both locales", () => {
  const inputs = [
    ["en-us", "Smite Adjustments", [
      "[New] Champions with Smite deal bonus True damage.",
      "[Removed] Champions with Smite deal bonus damage to monsters.",
    ]],
    ["ru-ru", "Изменения Кары", [
      "[Новое] Чемпионы с Карой наносят дополнительный чистый урон.",
      "[Удалено] Чемпионы с Карой наносят монстрам дополнительный урон.",
    ]],
  ];
  const rows = [];
  for (const [locale, heading, details] of inputs) {
    const spell = {
      slug: "smite",
      name: locale === "ru-ru" ? "Кара" : "Smite",
      imageUrl: "https://assets.example.test/smite.png",
      tooltipImageUrl: "https://assets.example.test/smite.png",
    };
    const catalog = {
      ...emptyCatalog,
      spells: new Map([[locale === "ru-ru" ? "кара" : "smite", spell]]),
    };
    const changes = parseChanges("7.3", locale, `
      <h2>${locale === "ru-ru" ? "ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА" : "GAMEPLAY CHANGES"}</h2>
      <h3>${heading}</h3><ul>${details.map((detail) => `<li>${detail}</li>`).join("")}</ul>
    `, catalog);

    assert.equal(changes.filter((change) => /^(?:изменения кары|smite adjustments)$/i.test(change.entityName)).length, 0);
    assert.equal(changes.filter((change) => change.entityKind === "spell").length, 1);
    const [row] = buildPatchChangeRows(changes, catalog).filter((change) => change.entityKind === "spell");
    assert.equal(row.entitySlug, "smite");
    assert.equal(row.changeType, "adjustment");
    assert.ok(row.imageUrl?.includes("guide-summonerspell-smite-image"));
    assert.deepEqual(row.details.map(({ text }) => text), details);
    rows.push(row);
  }

  assert.deepEqual(rows.map(({ entityKind, entitySlug, changeType, details }) => [
    entityKind,
    entitySlug,
    changeType,
    details.length,
  ]), [
    ["spell", "smite", "adjustment", 2],
    ["spell", "smite", "adjustment", 2],
  ]);
  assert.equal(rows[0].imageUrl, rows[1].imageUrl);
});

test("keeps nested 3.1 summoner-spell headings as spell entities and their own details", () => {
  const spells = ["Exhaust", "Heal", "Ignite", "Smite", "Barrier"];
  const catalog = {
    ...emptyCatalog,
    spells: new Map(spells.map((name) => [name.toLowerCase(), { slug: name.toLowerCase(), name }])),
  };
  const changes = parseChanges("3.1", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>ITEMS</h3><h4>Black Cleaver</h4><p>Attack damage: 30 → 35.</p>
    <h3>SUMMONER SPELLS</h3>
    <h4>Exhaust</h4><p>Slow: 20% → 60% decaying over 2 seconds.</p>
    <h4>Heal</h4><ul><li>[New] Heal your ally for 120–484 health and grant 40% movement speed.</li></ul>
    <p>Base heal: 80–360 → 60–242.</p><p>Base movement speed: 30% → 20%.</p><p>Cooldown: 120s → 130s.</p>
    <h4>Ignite</h4><p>Damage: 60–410 → 72–380.</p>
    <h4>Smite</h4><p>Minion gold and experience penalty duration: 5 → 6 minutes.</p>
    <h3>MONSTERS</h3><h4>Baron Nashor</h4><p>Base health: 10,000 → 11,000.</p>
  `, catalog);
  const spellRows = changes.filter(({ entityKind }) => entityKind === "spell");

  assert.deepEqual(spellRows.map(({ entitySlug }) => entitySlug), ["exhaust", "heal", "ignite", "smite"]);
  assert.deepEqual(spellRows.map(({ entityName }) => entityName), ["Exhaust", "Heal", "Ignite", "Smite"]);
  assert.deepEqual(spellRows.find(({ entitySlug }) => entitySlug === "heal").details.map(({ text }) => text), [
    "[New] Heal your ally for 120–484 health and grant 40% movement speed.",
    "Base heal: 80–360 → 60–242.",
    "Base movement speed: 30% → 20%.",
    "Cooldown: 120s → 130s.",
  ]);
  assert.equal(spellRows.length, 4, "monster text containing the word 'health' must not create a Heal spell row");
});

test("strips prefix NEW marker before mapping 4.3 rune headings", () => {
  const catalog = {
    ...emptyCatalog,
    runes: new Map([
      ["first strike", { slug: "first-strike", name: "First Strike" }],
      ["legend alacrity", { slug: "legend-alacrity", name: "Legend: Alacrity" }],
    ]),
  };
  const changes = parseChanges("4.3", "en-us", `
    <h2>NEW RUNES</h2>
    <h3>[NEW] FIRST STRIKE</h3><p>Damage dealt: 10% → 8%.</p>
    <h3>[NEW] LEGEND: ALACRITY</h3><p>Attack speed: 3% → 5%.</p>
    <h3>[NEW] HEXTECH FLASTRAPTION</h3><p>Slow enemies with active items.</p>
  `, catalog);
  const firstStrike = changes.find(({ entityKind, entitySlug }) => entityKind === "rune" && entitySlug === "first-strike");
  const alacrity = changes.find(({ entityKind, entitySlug }) => entityKind === "rune" && entitySlug === "legend-alacrity");
  const uncatalogued = changes.find(({ entityKind, entityName }) => entityKind === "rune" && /HEXTECH FLASTRAPTION/i.test(entityName));

  assert.ok(firstStrike);
  assert.equal(firstStrike.entityName, "FIRST STRIKE");
  assert.equal(firstStrike.changeName, "new");
  assert.deepEqual(firstStrike.details.map(({ text }) => text), ["Damage dealt: 10% → 8%."]);
  assert.ok(alacrity);
  assert.equal(alacrity.entityName, "LEGEND: ALACRITY");
  assert.equal(alacrity.changeName, "new");
  assert.deepEqual(alacrity.details.map(({ text }) => text), ["Attack speed: 3% → 5%."]);
  assert.ok(uncatalogued);
  assert.equal(uncatalogued.entityName, "HEXTECH FLASTRAPTION");
  assert.equal(uncatalogued.entitySlug, undefined);
  assert.equal(uncatalogued.changeName, "new");
});

test("maps a historical rune after its tree prefix without a patch-version rule", () => {
  const rune = parseChanges("9.9", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>RUNE CHANGES</h3>
    <h4>INSPIRATION: MASTERMIND</h4><ul><li>Gold bonus on objective kill: 120 → 40</li></ul>
  `).find(({ entityKind }) => entityKind === "rune");

  assert.equal(rune?.entitySlug, "mastermind");
  assert.deepEqual(rune?.details.map(({ label, before, after }) => [label, before, after]), [
    ["Gold bonus on objective kill", "120", "40"],
  ]);
  const [row] = buildPatchChangeRows([rune], emptyCatalog);
  assert.equal(row.entitySlug, "mastermind");
  assert.equal(row.changeType, "nerf");
});

test("keeps patch 7.3b jungle monster names, explanation, and localized health details", () => {
  const inputs = [
    ["en-us", `
      <h2>Other Battlefield Content</h2><h4>Jungle Monsters</h4>
      <p>Raptors are tougher to reduce pressure on junglers defending their camps.</p>
      <p>Crimson Raptor</p><ul><li>Base Health: 1000 → 1100</li><li>Health per level: 110 → 125</li></ul>
      <p>Raptor</p><ul><li>Base Health: 500 → 550</li><li>Health per level: 55 → 65</li></ul>
      <h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><p>Not part of the Rift changes.</p>
    `, "Jungle Monsters", "Crimson Raptor", "Raptor", "Base Health"],
    ["ru-ru", `
      <h2>Прочие изменения поля боя</h2><p>Лесные монстры</p>
      <p>Остроклювы стали слишком простыми целями для вторжений в лес.</p>
      <p>Алый остроклюв</p><ul><li>Базовый запас здоровья: 1000 → 1100</li><li>Прирост здоровья: 110 → 125</li></ul>
      <p>Остроклюв</p><ul><li>Базовый запас здоровья: 500 → 550</li><li>Прирост здоровья: 55 → 65</li></ul>
      <h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2><p>AAA ARAM</p><p>Изменение режима.</p>
    `, "Лесные монстры", "Алый остроклюв", "Остроклюв", "Базовый запас здоровья"],
  ];

  for (const [locale, body, entityName, firstMonster, secondMonster, healthLabel] of inputs) {
    const changes = parseChanges("7.3b", locale, body);
    const jungle = changes.find((change) => change.entityKind === "system" && change.entityName === entityName);
    assert.ok(jungle);
    assert.equal(jungle.details[0].text, locale === "ru-ru"
      ? "Остроклювы стали слишком простыми целями для вторжений в лес."
      : "Raptors are tougher to reduce pressure on junglers defending their camps.");
    assert.deepEqual(jungle.details.filter((detail) => detail.before && detail.after).map((detail) => [
      detail.component,
      detail.label,
      detail.before,
      detail.after,
    ]), [
      [firstMonster, healthLabel, "1000", "1100"],
      [firstMonster, locale === "ru-ru" ? "Прирост здоровья" : "Health per level", "110", "125"],
      [secondMonster, healthLabel, "500", "550"],
      [secondMonster, locale === "ru-ru" ? "Прирост здоровья" : "Health per level", "55", "65"],
    ]);
    assert.equal(changes.some((change) => /AAA ARAM/i.test(change.entityName || "") && change.scope?.type !== "game-mode"), false);
  }
});

test("collects grouped jungle monster stat rows regardless of patch version", () => {
  const body = `<h2>GAME MODE CHANGES</h2><h3>Arena</h3><h4>Jungle Monsters</h4>
    <p>Arena-only monster durability.</p><p>Silver Raptor</p><ul><li>Base Health: 700 → 750</li></ul>
    <h2>Other Battlefield Content</h2><h4>Jungle Monsters</h4>
    <p>Monsters receive a durability update.</p>
    <p>Silver Raptor</p><ul><li>Base Health: 700 → 750</li><li>Health per level: 70 → 80</li></ul>`;
  const jungle = parseChanges("9.0", "en-us", body)
    .find((change) => change.entityKind === "system" && change.entityName === "Jungle Monsters");

  assert.ok(jungle);
  assert.equal(jungle.details[0].text, "Monsters receive a durability update.");
  assert.deepEqual(jungle.details.filter((detail) => detail.before && detail.after).map((detail) => [
    detail.component,
    detail.label,
    detail.before,
    detail.after,
  ]), [
    ["Silver Raptor", "Base Health", "700", "750"],
    ["Silver Raptor", "Health per level", "70", "80"],
  ]);
  assert.equal(jungle.details.some(({ text }) => /Arena-only/.test(text)), false);
  assert.equal(jungle.details.filter(({ label }) => label === "Base Health").length, 1);
});

test("does not duplicate a guild leaderboard row already recovered from its heading", () => {
  const name = "Guild Leaderboard Settlement Rules Optimization";
  const changes = parseChanges("7.3b", "en-us", `
    <h2>OTHER ADJUSTMENTS</h2><h3>${name}</h3>
    <p>Guild Leaderboard points are calculated at 11:55 PM every Sunday, and the leaderboard refreshes at 12:00 AM.</p>
  `);
  assert.equal(changes.filter((change) => change.entityKind === "system" && change.entityName === name).length, 1);
});

test("recovers generic supplemental system sections after main patch sections across versions", () => {
  for (const version of ["3.0a", "6.2k", "7.3b", "9.0"]) {
    const changes = parseChanges(version, "en-us", supplementalSystemSections, emptyCatalog, "");
    const scheduleRows = changes.filter((change) => change.entityKind === "system"
      && change.entityName === "Weekly Leaderboard Settlement Schedule");

    assert.equal(scheduleRows.length, 1, `expected one schedule row in patch ${version}`);
    assert.equal(scheduleRows[0].sectionName, "Other Adjustments");
    assert.deepEqual(scheduleRows[0].details.map(({ text }) => text), [
      "Ranking points are calculated at 11:55 PM every Sunday.",
      "The leaderboard refreshes at 12:00 AM.",
    ]);
    assert.equal(changes.some((change) => change.entityName === "Featured Collection"), false);
  }

  const russianChanges = parseChanges("6.2k", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ЧЕМПИОНОВ</h2><p>Настроен баланс.</p>
    <h2>ИСПРАВЛЕНИЯ ОШИБОК</h2><p>Исправлена ошибка.</p>
    <h2>Оптимизация расписания еженедельного рейтинга</h2>
    <p>Очки рейтинга рассчитываются каждое воскресенье.</p>
    <p>Таблица лидеров обновляется в полночь.</p>
  `, emptyCatalog, "");
  const [russianSchedule] = russianChanges.filter((change) => change.entityKind === "system"
    && change.entityName === "Оптимизация расписания еженедельного рейтинга");

  assert.ok(russianSchedule);
  assert.equal(russianSchedule.sectionName, "Прочие изменения");
  assert.deepEqual(russianSchedule.details.map(({ text }) => text), [
    "Очки рейтинга рассчитываются каждое воскресенье.",
    "Таблица лидеров обновляется в полночь.",
  ]);
});

test("does not duplicate 6.2k Yordle item changes as system rows in either locale", () => {
  const infinityOrb = { slug: "infinity-orb", name: "Infinity Orb" };
  const seryldasGrudge = { slug: "seryldas-grudge", name: "Serylda's Grudge" };
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["infinity orb", infinityOrb],
      ["сфера бесконечности", infinityOrb],
      ["serylda s grudge", seryldasGrudge],
      ["злоба серильды", seryldasGrudge],
    ]),
  };

  for (const locale of ["en-us", "ru-ru"]) {
    const changes = parseChanges(riot62kNestedItems.patchVersion, locale, riot62kNestedItems[locale], catalog, riot62kNestedItems.fragmentId);
    const items = changes.filter(({ entityKind }) => entityKind === "item");
    const duplicatedSystems = changes.filter(({ entityKind, entityName }) => (
      entityKind === "system" && /(?:Infinity Orb|Serylda|Сфера бесконечности|Злоба Серильды)/iu.test(entityName)
    ));

    assert.equal(items.length, 2, `${locale}: both item headings remain item rows`);
    assert.equal(duplicatedSystems.length, 0, `${locale}: item headings must not become supplemental system rows`);
  }
});

test("recovers numeric deltas from an unclassified top-level topic heading", () => {
  const changes = parseChanges("9.9", "en-us", `
    <h3>UNKNOWN FEATURE</h3>
    <ul><li>Cooldown: 12s → 10s</li></ul>
  `, emptyCatalog, "");
  const feature = changes.find(({ entityKind, entityName }) => entityKind === "system" && entityName === "UNKNOWN FEATURE");

  assert.deepEqual(feature.details.map(({ text }) => text), ["Cooldown: 12s → 10s"]);
});

test("recovers prose-only feature topics under NEW while keeping entity categories separate", () => {
  const inputs = [
    ["en-us", `
      <h2>NEW</h2>
      <h3>PRACTICE MODE</h3><p>Added a practice mode for testing champion abilities.</p>
      <h3>LANGUAGES</h3><p>Added Korean and Japanese support.</p>
      <h3>CHAMPIONS</h3><h4>Nova</h4><p>Nova joins the Rift.</p>
      <h3>SKINS</h3><ul><li>Star Nova</li></ul>
    `, ["Practice Mode", "Languages"]],
    ["ru-ru", `
      <h2>НОВОЕ</h2>
      <h3>РЕЖИМ ТРЕНИРОВКИ</h3><p>Добавлен режим тренировки для проверки умений чемпионов.</p>
      <h3>ЯЗЫКИ</h3><p>Добавлена поддержка корейского и японского языков.</p>
      <h3>ЧЕМПИОНЫ</h3><h4>Нова</h4><p>Нова вступает в бой.</p>
      <h3>ОБРАЗЫ</h3><ul><li>Звездная Нова</li></ul>
    `, ["Режим тренировки", "Языки"]],
  ];

  for (const [locale, body, topicNames] of inputs) {
    const page = {
      url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-9-9/`,
      blades: [
        { type: "articleMasthead", title: "Wild Rift Patch Notes 9.9" },
        { type: "patchNotesRichText", richText: { body } },
      ],
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { page } },
    })}</script>`;
    const changes = parsePatchArticle(html, "9.9", locale, emptyCatalog).changes;
    const systemRows = changes.filter((change) => change.entityKind === "system");
    for (const topicName of topicNames) {
      const row = systemRows.find((change) => change.entityName.toLocaleLowerCase(locale) === topicName.toLocaleLowerCase(locale));
      assert.ok(row, `${locale}: missing new feature topic ${topicName}`);
      assert.equal(row.changeName, "new");
      assert.equal(row.sectionName, locale === "ru-ru" ? "НОВОЕ" : "NEW");
      assert.ok(row.details.some(({ text }) => text.length > 10));
    }
    assert.equal(systemRows.some((change) => /^(?:NEW|НОВОЕ|CHAMPIONS|SKINS|ЧЕМПИОНЫ|ОБРАЗЫ|Nova|Нова)$/u.test(change.entityName)), false);
  }
});

test("adds localized 7.2 tier 3 items and preserves the single confirmed Scorpio Deity skin", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["void staff", { slug: "void-staff", name: "Void Staff" }],
      ["посох бездны", { slug: "void-staff", name: "Void Staff" }],
      ["banshee s veil", { slug: "banshees-veil", name: "Banshee's Veil" }],
      ["завеса банши", { slug: "banshees-veil", name: "Banshee's Veil" }],
    ]),
  };
  const bodies = [
    ["en-us", [
      "<h2>ITEM ADJUSTMENTS</h2><h4>Void Staff</h4><p>Void Staff remains a late-game magic penetration item.</p>",
      "<h4>Banshee's Veil</h4><p>We've folded Crown of the Shattered Queen's effect into Banshee's Veil.</p><p>Base Stats:</p><ul><li>Price: 3000</li></ul><p>Annul:</p><ul><li>Grants a spell shield.</li></ul>",
      "<h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><p>Void Staff</p><p>Effects synchronized with Ranked.</p>",
    ].join("")],
    ["ru-ru", [
      "<p><strong>Изменения предметов</strong></p><h4>Посох Бездны</h4><ul><li>Теперь предмет соответствует версии из ранговых матчей.</li></ul>",
      "<h4><strong>Завеса банши</strong></h4><p>Мы объединили эффект Венца Расколотой королевы и Завесы банши.</p><p>Основные параметры</p><ul><li>Стоимость: 3000</li></ul>",
      "<p>Космическое жало Скарнер появится в игре 9 июля.</p><p>Мини-пропуск Wild Rift \"Космическое жало Скарнер\"</p><ul><li>27 августа выйдет мини-пропуск, где вас будет ждать Космическое жало Скарнер.</li></ul>",
    ].join("")],
  ];
  for (const [locale, body] of bodies) {
    const changes = parseChanges("7.2", locale, body, catalog);
    const voidRows = changes.filter((change) => change.entityKind === "item" && change.entitySlug === "void-staff");
    const bansheeRows = changes.filter((change) => change.entityKind === "item" && change.entitySlug === "banshees-veil");
    const voidStaff = voidRows[0];
    const banshee = bansheeRows[0];
    assert.equal(voidRows.length, 1);
    assert.equal(voidStaff?.entityName, locale === "ru-ru" ? "Посох Бездны" : "Void Staff");
    assert.equal(voidStaff?.changeName, "adjustment");
    assert.equal(bansheeRows.length, 1);
    assert.equal(banshee?.entityName, locale === "ru-ru" ? "Завеса банши" : "Banshee's Veil");
    assert.equal(banshee?.changeName, "rework");
    assert.ok(voidStaff?.details.some((detail) => detail.text.includes(locale === "ru-ru" ? "ранговых матчей" : "late-game")));
    assert.ok(banshee?.details.some((detail) => detail.text.includes(locale === "ru-ru" ? "объединили эффект" : "folded Crown")));
    const skarnerSkin = changes.find((change) => change.entityKind === "skin" && change.entitySlug === "skarner-scorpio-deity-skarner");
    if (locale === "ru-ru") {
      assert.equal(skarnerSkin?.entityName, "Космическое жало Скарнер", changes.filter(({ entityKind }) => entityKind === "skin").map(({ entityName, entitySlug }) => `${entityName} (${entitySlug})`).join(" | "));
      assert.equal(skarnerSkin?.changeName, "new");
      assert.equal(skarnerSkin?.sectionName, "Облики патча");
      assert.match(skarnerSkin?.details[0].text || "", /27 августа/);
      assert.equal(changes.some((change) => change.entitySlug === "skarner-scorpio-deity-ancient-wisdom-skarner"), false);
    }
  }
});

test("keeps nested tier 3 item categories open for same-level item headings", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["void staff", { slug: "void-staff", name: "Void Staff" }],
      ["banshee s veil", { slug: "banshees-veil", name: "Banshee's Veil" }],
    ]),
  };
  const changes = parseChanges("7.2", "en-us", `
    <h3>MAGE ITEM UPDATES</h3>
    <h4>All Tier 3 Mage Items Adjustments</h4>
    <h4>Void Staff</h4><p>Void Staff remains a late-game magic penetration item.</p>
    <h4>Banshee's Veil</h4><p>We folded Crown's effect into Banshee's Veil.</p>
  `, catalog).filter((change) => change.entityKind === "item");

  assert.deepEqual(changes.map(({ entitySlug }) => entitySlug), ["void-staff", "banshees-veil"]);
  assert.ok(changes.every(({ sectionName }) => sectionName === "All Tier 3 Mage Items Adjustments"));
});

test("recovers localized aggregate item deltas alongside item changes", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["усиливающий фолиант", { slug: "amplifying-tome", name: "Усиливающий фолиант" }],
    ]),
  };
  const changes = parseChanges("7.2", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ПРЕДМЕТОВ</h2>
    <h3>ИЗМЕНЕНИЯ ПРЕДМЕТОВ ДЛЯ МАГОВ</h3>
    <h4><strong>Все изменения предметов 3-го ранга для магов</strong></h4>
    <ul><li>Магическое пробивание от предметов 3-го ранга для магов: 7% → 0</li></ul>
    <h4>Усиливающий фолиант</h4><ul><li>Сила умений: 25 → 20</li></ul>
  `, catalog);
  const aggregate = changes.find((change) => change.entityKind === "system"
    && change.entityName === "Все изменения предметов 3-го ранга для магов");

  assert.ok(aggregate);
  assert.ok(aggregate.details.some((detail) => detail.text.includes("7% → 0")));
  assert.ok(changes.some((change) => change.entityKind === "item"
    && change.entityName === "Усиливающий фолиант"
    && change.details.some((detail) => detail.text.includes("25 → 20"))));
});

test("recovers item stat rows from standalone historic item blocks without a category heading", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["plated steelcaps", { slug: "plated-steelcaps", name: "Plated Steelcaps" }],
      ["mercury s treads", { slug: "mercurys-treads", name: "Mercury's Treads" }],
    ]),
  };
  const changes = parseChanges("5.2", "en-us", `
    <h4>PLATED STEELCAPS</h4><p><em>Block</em></p>
    <ul><li><p>Reduces physical damage taken by 10% → <strong>7–10% (based on level)</strong></p></li></ul>
    <p>MERCURY’S TREADS</p><p><em>Dissolve</em></p>
    <ul><li><p>Reduces magic damage taken by 12% → <strong>7–12% (based on level)</strong></p></li></ul>
    <h3>RUNE CHANGES</h3>
  `, catalog).filter((change) => change.entityKind === "item");

  assert.equal(changes.length, 2);
  assert.ok(changes.some((change) => change.entitySlug === "plated-steelcaps"
    && change.details.some((detail) => detail.text.includes("7–10% (based on level)"))));
  assert.ok(changes.some((change) => change.entitySlug === "mercurys-treads"
    && change.details.some((detail) => detail.text.includes("7–12% (based on level)"))));
});

test("splits shared item headings into linked item rows with the same source details", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["relic shield", { slug: "relic-shield", name: "Relic Shield" }],
      ["targon s buckler", { slug: "targons-buckler", name: "Targon's Buckler" }],
    ]),
  };
  const changes = parseChanges("4.1", "en-us", `
    <h2>ITEMS</h2>
    <h4>RELIC SHIELD/TARGON’S BUCKLER</h4>
    <ul>
      <li>Charge cooldown: 20s → 30s</li>
      <li>Gold: 25g → 40g</li>
    </ul>
  `, catalog).filter((change) => change.entityKind === "item");

  assert.deepEqual(changes.map((change) => change.entitySlug).sort(), ["relic-shield", "targons-buckler"]);
  assert.ok(changes.every((change) => change.details.some((detail) => detail.text.includes("20s → 30s"))));
});

test("recovers champion stats from broad endurance headings in old articles", () => {
  const akali = { slug: "akali", name: "Akali" };
  const catalog = { ...emptyCatalog, champions: new Map([["akali", akali]]) };
  const changes = parseChanges("6.0", "en-us", `
    <h3>Endurance changes: Champion stats</h3>
    <p>Akali</p>
    <ul><li>Base Health: 600 → 630; Health per level: 125 → 140</li></ul>
  `, catalog);
  const row = changes.find((change) => change.entityKind === "champion" && change.entitySlug === "akali");

  assert.ok(row);
  assert.ok(row.details.some((detail) => detail.text.includes("600 → 630")));
  assert.ok(row.details.some((detail) => detail.text.includes("125 → 140")));
});

test("recovers champion changes from a standalone champion heading in an old Riot blade", () => {
  const garen = { slug: "garen", name: "Garen" };
  const catalog = { ...emptyCatalog, champions: new Map([["garen", garen]]) };
  const changes = parseChanges("6.1b", "en-us", `
    <h4>GAREN</h4>
    <p>After his rework, Garen is outperforming, so we are tuning his abilities.</p>
    <p><em>(3) Judgment</em></p>
    <ul>
      <li>Damage bonus ratio: 35/40/45/50% Attack Damage → 25/30/35/40% Attack Damage</li>
      <li>Armor Shred effect: 25% → 15%</li>
    </ul>
  `, catalog);
  const row = changes.find((change) => change.entityKind === "champion" && change.entitySlug === "garen");

  assert.ok(row);
  assert.ok(row.details.some((detail) => detail.text.includes("35/40/45/50% Attack Damage")));
  assert.ok(row.details.some((detail) => detail.text.includes("25% → 15%")));
});

test("keeps same-level new boot upgrades and skips their purchase-rules subheading", () => {
  const upgrades = [
    ["spellslingers-shoes", "Spellslinger's Shoes", "Boots of Mana"],
    ["chainlaced-crushers", "Chainlaced Crushers", "Mercury's Treads"],
    ["gunmetal-greaves", "Gunmetal Greaves", "Berserker's Greaves"],
    ["armored-advance", "Armored Advance", "Plated Steelcaps"],
    ["immortal-treads", "Immortal Treads", "Gluttonous Greaves"],
    ["armorcrusher-boots", "Armorcrusher Boots", "Boots of Dynamism"],
    ["crimson-lucidity", "Crimson Lucidity", "Ionian Boots of Lucidity"],
  ];
  const normalizeItemAlias = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const catalogItems = upgrades.flatMap(([slug, name, baseItem]) => [
    [normalizeItemAlias(name), { slug, name }],
    [normalizeItemAlias(baseItem), { slug: `base-${slug}`, name: baseItem }],
  ]);
  const catalog = {
    ...emptyCatalog,
    items: new Map(catalogItems),
  };
  const body = `
    <h3>BOOTS ADJUSTMENTS</h3>
    <h4>Tier 3 Boots Purchase Regulations</h4>
    <ul><li>Once the game time reaches 10:00, you can upgrade their boots.</li></ul>
    ${upgrades.map(([, name, baseItem]) => `<h4><strong>${name} (${baseItem} Upgrade) [New]</strong></h4><p>Base Stats:</p><ul><li>Price: 2200</li></ul>`).join("")}
  `;
  const changes = parseChanges("7.2", "en-us", body, catalog).filter((change) => change.entityKind === "item");

  assert.deepEqual(changes.map(({ entitySlug }) => entitySlug), upgrades.map(([slug]) => slug));
  assert.ok(changes.every(({ changeName, sectionName }) => changeName === "new" && sectionName === "BOOTS ADJUSTMENTS"));
  assert.equal(changes.some(({ entityName }) => entityName === "Tier 3 Boots Purchase Regulations"), false);
});

test("recognizes localized tier 3 item subsections as structure rather than entities", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([
      ["посох бездны", { slug: "void-staff", name: "Посох Бездны" }],
    ]),
  };
  const changes = parseChanges("7.2", "ru-ru", `
    <h3>ИЗМЕНЕНИЯ БОТИНОК</h3>
    <h4>Правила покупки ботинок 3-го ранга</h4>
    <ul><li>Улучшения доступны после 10:00.</li></ul>
    <h3>ИЗМЕНЕНИЯ ПРЕДМЕТОВ МАГОВ</h3>
    <h4>Все изменения предметов 3-го ранга для магов</h4>
    <h4>Посох Бездны</h4><ul><li>Урон: 100 → 120</li></ul>
  `, catalog).filter((change) => change.entityKind === "item");

  assert.deepEqual(changes.map(({ entitySlug }) => entitySlug), ["void-staff"]);
  assert.equal(changes[0].sectionName, "Все изменения предметов 3-го ранга для магов");
});

test("extracts an unseen item's stats from an arbitrary patch item-adjustments section", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>ITEM ADJUSTMENTS</h2><h4>Prismatic Resolver</h4>
    <h5>Base Stats</h5><ul><li>Ability Power: 70 → 80</li></ul>
  `);
  const item = changes.find((entry) => entry.entityKind === "item" && entry.entityName === "Prismatic Resolver");

  assert.ok(item);
  assert.equal(item.entitySlug, undefined);
  assert.equal(item.changeName, "buff");
  assert.equal(item.details[0].after, "80");
});

test("separates paragraph-based item stat blocks from the official Riot 3.0a structure", () => {
  const itemEntries = [
    ["archangel s staff", "archangel-staff", "Archangel's Staff"],
    ["seraph s embrace", "seraphs-embrace", "Seraph's Embrace"],
    ["serrated dirk", "serrated-dirk", "Serrated Dirk"],
    ["edge of night", "edge-of-night", "Edge of Night"],
    ["youmuu s ghostblade", "youmuus-ghostblade", "Youmuu's Ghostblade"],
    ["umbral glaive", "umbral-glaive", "Umbral Glaive"],
  ];
  const catalog = {
    ...emptyCatalog,
    items: new Map(itemEntries.map(([alias, slug, name]) => [alias, { slug, name }])),
  };
  const changes = parseChanges("3.0a", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><h3>ITEMS</h3>
    <h4>ARCHANGEL’S STAFF/SERAPH’S EMBRACE</h4>
    <p>Seraph’s Embrace is currently the premiere item of choice for Enchanters and Mages. We want to bring Seraph’s back in line with the other item choices, so we’re taking away some of the ability haste it provides while also reducing some of its shielding power.</p>
    <p>Archangel’s Staff</p><ul><li>Ability haste: 25 → 20</li></ul>
    <p>Seraph’s Embrace</p><ul><li>Ability haste: 25 → 20</li><li>Lifeline shield value: 15% of current mana + 150 → 15% current mana + 100</li></ul>
    <h4>SERRATED DIRK</h4>
    <p>We are adjusting Serrated Dirk so that it provides less armor penetration in the early game, while buffing the armor penetration provided by the items that Serrated Dirk builds into.</p>
    <p>Serrated Dirk</p><ul><li>Armor penetration: 10 → 8</li></ul>
    <p>Edge of Night</p><ul><li>Armor penetration: 10 → 8</li></ul>
    <p>Youmuu’s Ghostblade</p><ul><li>Armor penetration: 10 → 12</li></ul>
    <p>Umbral Glaive</p><ul><li>Armor penetration: 10 → 12</li></ul>
  `, catalog).filter((change) => change.entityKind === "item");
  const bySlug = new Map(changes.filter((change) => change.entitySlug).map((change) => [change.entitySlug, change]));
  const umbralRows = changes.filter((change) => change.entityName === "Umbral Glaive");

  assert.equal(bySlug.size, 6);
  assert.equal(changes.length, 6, "all six item blocks, including the uncatalogued one, produce one row each");
  assert.equal(changes.filter((change) => change.entitySlug === "seraphs-embrace").length, 1);
  assert.deepEqual(bySlug.get("archangel-staff")?.details.map(({ text }) => text), ["Ability haste: 25 → 20"]);
  assert.equal(umbralRows.length, 1);
  assert.equal(umbralRows[0].entitySlug, "umbral-glaive");
  assert.deepEqual(umbralRows[0].details.map(({ text }) => text), ["Armor penetration: 10 → 12"]);
  assert.equal(bySlug.get("youmuus-ghostblade")?.details.some(({ text }) => /Umbral Glaive/i.test(text)), false);
  assert.deepEqual(bySlug.get("seraphs-embrace")?.details.map(({ text }) => text), [
    "Ability haste: 25 → 20",
    "Lifeline shield value: 15% of current mana + 150 → 15% current mana + 100",
  ]);
});

test("keeps both 7.2 Scorpio Deity skins as new English Wild Pass entries", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["skarner", { slug: "skarner", name: "Skarner", aliases: ["Skarner"] }]]),
  };
  const skins = parseChanges("7.2", "en-us", `
    <h2>SKINS</h2>
    <p>Scorpio Deity Skarner Releasing August 27 @ 00:01 UTC</p>
    <p>Scorpio Deity Ancient Wisdom Skarner Releasing August 27 @ 00:01 UTC</p>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");

  assert.deepEqual(skins.map(({ entitySlug, changeName, sectionName }) => [entitySlug, changeName, sectionName]), [
    ["skarner-scorpio-deity-skarner", "new", "SKINS"],
    ["skarner-scorpio-deity-ancient-wisdom-skarner", "new", "SKINS"],
  ]);
});

test("extracts named skins from probability tables without patch-specific rules", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["ahri", { slug: "ahri", name: "Ahri", aliases: ["Ahri"] }]]),
  };
  const changes = parseChanges("9.0", "en-us", `
    <h2>OTHER ADJUSTMENTS</h2>
    <p>The festival chest contains six cosmetic variants.</p>
    <table><tbody>
      <tr><td>Festival Chest with Ahri</td><td>5%</td></tr>
      <tr><td>Festival Ahri Ruby</td><td>12.5%</td></tr>
      <tr><td>Festival Ahri Sapphire</td><td>12.5%</td></tr>
    </tbody></table>
  `, catalog).filter((change) => change.entityKind === "skin");

  assert.deepEqual(changes.map(({ entityName, entitySlug, changeName }) => [entityName, entitySlug, changeName]), [
    ["Festival Ahri Ruby", "ahri-festival-ahri-ruby", "available"],
    ["Festival Ahri Sapphire", "ahri-festival-ahri-sapphire", "available"],
  ]);
});

test("normalizes 7.1g and 7.1e Russian skin slugs to their canonical English identities", () => {
  const champions = [
    ["aatrox", "Атрокс"], ["sion", "Сион"], ["samira", "Самира"],
    ["norra", "Норра"], ["taliyah", "Талия"],
  ];
  const catalog = {
    ...emptyCatalog,
    champions: new Map(champions.map(([slug, name]) => [name, { slug, name, aliases: [name] }])),
  };
  const cases = [
    ["7.1g", [
      ["Механический Атрокс (изысканное издание)", "aatrox-mecha-aatrox-exquisite-edition"],
      ["Защитник растений Сион", "sion-plant-protector-sion"],
      ["Пепельная мстительница Самира", "samira-ashen-avenger-samira"],
    ]],
    ["7.1e", [
      ["Норра из кафе красоты", "norra-cafe-cuties-norra"],
      ["Тусовая Талия", "taliyah-pool-party-taliyah"],
    ]],
  ];

  for (const [version, skins] of cases) {
    const body = `<h2>ОБРАЗЫ</h2>${skins.map(([name]) => `<p>${name}</p>`).join("")}`;
    const parsed = parseChanges(version, "ru-ru", body, catalog).filter(({ entityKind }) => entityKind === "skin");
    for (const [name, canonicalSlug] of skins) {
      const skin = parsed.find(({ entityName }) => entityName === name);
      assert.ok(skin, `${version} RU should include ${name}`);
      assert.equal(skin.entitySlug, canonicalSlug);
    }
  }
});

test("canonicalizes older skin names captured together with Riot promotional copy", () => {
  const champions = new Map(skinChampionCatalog.champions);
  for (const [slug, name, ru] of [
    ["ekko", "Ekko", "Экко"],
    ["veigar", "Veigar", "Вейгар"],
    ["xin-zhao", "Xin Zhao", "Ксин Жао"],
  ]) {
    const champion = { slug, name, nameLocalizations: { "ru-ru": ru } };
    champions.set(name.toLowerCase(), champion);
    champions.set(ru.toLowerCase(), champion);
  }
  const catalog = { ...emptyCatalog, champions };
  const body = `
    <h2>SKINS</h2>
    <p>A new Mini Pass featuring Ascended Food Spirits Amumu and more rewards.</p>
    <p>Along with the limited-time return of Ascended Psychic Detective Ekko.</p>
    <p>We'll be kicking off ranked season 12 real soon, give a warm welcome to Glorious Crown Xin Zhao.</p>
    <p>A new Blackfrost Renekton Mini Pass will go live after the Food Spirits Veigar.</p>
    <p>The limited-time return of Ascended Supervillain Graves.</p>
  `;
  const skins = parseChanges("5.2", "ru-ru", body, catalog)
    .filter(({ entityKind }) => entityKind === "skin");
  const expected = [
    ["amumu-ascended-food-spirits-amumu", "Вознесшийся Гурман Амуму"],
    ["ekko-ascended-psychic-detective-ekko", "Вознесшийся Пси-детектив Экко"],
    ["xin-zhao-glorious-crown-xin-zhao", "Блистательный король Ксин Жао"],
    ["renekton-blackfrost-renekton", "Ренектон Черная Стужа"],
    ["veigar-food-spirits-veigar", "Фруктовый Вейгар"],
    ["graves-ascended-supervillain-graves", "Вознесшийся Суперзлодей Грейвз"],
  ];

  for (const [slug, name] of expected) {
    assert.ok(skins.some((row) => row.entitySlug === slug && row.entityName === name), `${slug}: ${name}; got ${JSON.stringify(skins)}`);
  }
});

test("fills the 7.2 localized skin release and return rows from the official article text", () => {
  const inputs = [
    ["en-us", `
      <p>Season-exclusive skin Glorious Eminence Renekton will be released July 10.</p>
      <h2>NEW WILD PASS</h2><p>Movie Director Wild Pass starring Movie Director Ryze and Ascended Movie Director Ryze.</p>
      <h3>Returning Wild Pass skins</h3><ul><li>Dream Raider Kha'Zix</li><li>Ascended Dream Raider Kha'Zix</li><li>Superhero Jayce</li><li>Ascended Superhero Jayce</li></ul>
      <h3>Returning Mini Wild Pass skins</h3><ul><li>Elderwood Xayah</li><li>Elderwood Xayah (Indigo)</li><li>Elderwood Rakan</li><li>Elderwood Rakan (Turquoise)</li></ul>
      <p>Unlock three Cyber Pop Zoe chromas.</p><p>A new Mini Wild Pass Return Track featuring Battlecast Nasus has been added. Progress is shared with the current Wild Pass, allowing you to unlock rewards from both tracks simultaneously.</p>
      <p>Unlock the all-new Purple Garlic Lulu skin.</p>
    `, [
      ["renekton-glorious-eminence-renekton", "new"],
      ["ryze-movie-director-ryze", "new"], ["ryze-ascended-movie-director-ryze", "new"],
      ["khazix-dream-raider-khazix", "returning"], ["khazix-ascended-dream-raider-khazix", "returning"],
      ["jayce-superhero-jayce", "returning"], ["jayce-ascended-superhero-jayce", "returning"],
      ["xayah-elderwood-xayah", "returning"], ["xayah-elderwood-xayah-indigo", "returning"],
      ["rakan-elderwood-rakan", "returning"], ["rakan-elderwood-rakan-turquoise", "returning"],
      ["zoe-cyber-pop-zoe-chromas", "available"], ["nasus-battlecast-nasus", "returning"], ["lulu-purple-garlic-lulu", "new"],
    ]],
    ["ru-ru", `
      <p>Эксклюзивный образ «Блистательная знаменитость Ренектон» появится в игре 10 июля.</p>
      <h2>НОВЫЙ ПРОПУСК WILD RIFT</h2><p>Режиссер Райз и Вознесшийся режиссер Райз.</p>
      <h3>Повторные образы пропуска Wild Rift</h3><ul><li>Похититель снов Ка'Зикс</li><li>Вознесшийся Похититель снов Ка'Зикс</li><li>Супергерой Джейс</li><li>Вознесшийся супергерой Джейс</li></ul>
      <h3>Повторные образы мини-пропуска Wild Rift</h3><ul><li>Дух леса Шая</li><li>Дух леса Шая (темно-синий)</li><li>Дух леса Рэйкан</li><li>Дух леса Рэйкан (бирюзовый)</li></ul>
      <p>Цветовые схемы Киберпоп-Зои.</p><p>Добавлена новая шкала повторных наград мини-пропуска Wild Rift с Модифицированным Насусом. У шкал текущих и повторных наград общий прогресс, а значит, вы сможете разблокировать награды одновременно.</p>
      <p>Новый образ «Фиолетовый чеснок Лулу».</p>
    `, [
      ["renekton-glorious-eminence-renekton", "new"],
      ["ryze-movie-director-ryze", "new"], ["ryze-ascended-movie-director-ryze", "new"],
      ["khazix-dream-raider-khazix", "returning"], ["khazix-ascended-dream-raider-khazix", "returning"],
      ["jayce-superhero-jayce", "returning"], ["jayce-ascended-superhero-jayce", "returning"],
      ["xayah-elderwood-xayah", "returning"], ["xayah-elderwood-xayah-indigo", "returning"],
      ["rakan-elderwood-rakan", "returning"], ["rakan-elderwood-rakan-turquoise", "returning"],
      ["zoe-cyber-pop-zoe-chromas", "available"], ["nasus-battlecast-nasus", "returning"], ["lulu-purple-garlic-lulu", "new"],
    ]],
  ];

  for (const [locale, body, expected] of inputs) {
    const changes = parseChanges("7.2", locale, body, skinChampionCatalog);
    const expectedSkinSlugs = expected.map(([slug]) => slug).sort();
    const actualSkinSlugs = changes
      .filter(({ entityKind }) => entityKind === "skin")
      .map(({ entitySlug }) => entitySlug)
      .sort();
    assert.deepEqual(actualSkinSlugs, expectedSkinSlugs, `${locale} should not infer extra skins from Wild Pass promotional copy`);
    for (const [slug, status] of expected) {
      const matches = changes.filter((change) => change.entityKind === "skin" && change.entitySlug === slug);
      assert.equal(matches.length, 1, `${locale} should emit one row for ${slug}; found ${changes.filter(({ entityKind }) => entityKind === "skin").map(({ entityName, entitySlug, changeName }) => `${entityName} (${entitySlug}, ${changeName})`).join(" | ")}`);
      assert.equal(matches[0].changeName, status, `${locale} status for ${slug}`);
    }
  }
});

test("infers item adjustment type from the article's changed stats", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([["mercury s treads", { slug: "mercurys-treads", name: "Mercury's Treads" }]]),
  };
  const mercury = parseChanges("7.2", "en-us", `
    <h2>ITEM ADJUSTMENTS</h2><h3>Mercury's Treads</h3><p>Base Stats</p>
    <ul><li>Price: 900 → 1200</li><li>Tenacity: 0 → 15%</li></ul>
  `, catalog).find((change) => change.entityKind === "item" && change.entitySlug === "mercurys-treads");
  assert.equal(mercury?.changeName, "adjustment");
});

test("preserves prefixed item variants as distinct catalog identities across old and new patch prose", () => {
  const items = [
    { slug: "infinity-orb", name: "Infinity Orb", aliases: ["Сфера бесконечности"] },
    { slug: "seryldas-grudge", name: "Serylda's Grudge", aliases: ["Злоба Серильды"] },
  ];
  const catalog = {
    ...emptyCatalog,
    items: new Map(items.flatMap((item) => [
      [item.name.toLowerCase().replace(/[’']/g, " "), item],
      ...item.aliases.map((alias) => [alias.toLowerCase().replace(/[’']/g, " "), item]),
    ])),
  };
  const inputs = [
    ["en-us", `
      <h2>GAMEPLAY CHANGES</h2><h3>ITEMS</h3>
      <h4>Yordle Infinity Orb</h4><p>Damage is too high.</p><h5>Thunderfall</h5><ul><li>Damage: 50 → 40</li></ul>
      <h4>Yordle Serylda's Grudge</h4><p>Ability damage is too high.</p><h5>Frostbite</h5><ul><li>Damage: 25 → 10</li></ul>
    `],
    ["ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>ПРЕДМЕТЫ</h3>
      <h4>Йордловская Сфера бесконечности</h4><p>Урон слишком высок.</p><h5>Раскаты грома</h5><ul><li>Урон: 50 → 40</li></ul>
      <h4>Йордловская Злоба Серильды</h4><p>Урон слишком высок.</p><h5>Обморожение</h5><ul><li>Урон: 25 → 10</li></ul>
    `],
  ];

  for (const [locale, body] of inputs) {
    const parsed = parseChanges("9.0", locale, body, catalog);
    const rows = buildPatchChangeRows(parsed, catalog, [], "9.0").filter(({ entityKind }) => entityKind === "item");
    assert.deepEqual(rows.map(({ entitySlug }) => entitySlug).sort(), [
      "variant-yordle-infinity-orb",
      "variant-yordle-seryldas-grudge",
    ]);
  }
});

test("preserves the six non-mode bug fixes for patch 7.1b in EN and RU", () => {
  const inputs = [
    ["en-us", `
      <h2>BUG FIXES</h2><ul>
        <li>Fixed an issue where Senna's Attack Speed behaved abnormally.</li>
        <li>Fixed an issue with Quicksilver Enchantment VFX.</li>
        <li>Fixed an issue with Glorious Enchant VFX.</li>
        <li>Fixed a description issue with the Battle Zeal rune.</li>
        <li>Fixed a description issue with the Cut Down rune.</li>
        <li>Fixed a description issue with the Ixtali Seedjar rune.</li>
      </ul><h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><p>Mode-only fix.</p>
    `, 6],
    ["ru-ru", `
      <h2>ИСПРАВЛЕНИЕ ОШИБОК</h2><ul>
        <li>Исправлена ошибка, приводившая к некорректному поведению скорости атаки Сенны.</li>
        <li>Исправлена ошибка при отображении визуальных эффектов Живого серебра.</li>
        <li>Исправлена ошибка при отображении визуальных эффектов Зачарования славы.</li>
        <li>Исправлена ошибка в описании руны Боевое рвение.</li>
        <li>Исправлена ошибка в описании руны Реванш.</li>
        <li>Исправлена ошибка в описании руны Банка для семян.</li>
      </ul><h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2><h3>AAA ARAM</h3><p>Исправлена ошибка режима.</p>
    `, 6],
  ];
  for (const [locale, body, count] of inputs) {
    const changes = parseChanges("7.1b", locale, body);
    const fixes = changes.find((change) => change.entityKind === "system"
      && /^(?:BUG FIXES|ИСПРАВЛЕНИЕ ОШИБОК)$/i.test(change.sectionName));
    assert.ok(fixes);
    assert.equal(fixes.details.length, count);
    assert.equal(fixes.details.some((detail) => /Mode-only|ошибка режима/i.test(detail.text)), false);
  }
});

test("preserves patch 7.2 non-mode bug fixes while excluding mode-only material", () => {
  const body = `
    <h2>BUG FIXES</h2><ul>
      <li>Garen (1) &amp; (2) abilities</li><li>Sona (1), (2) &amp; (3) abilities</li>
      <li>Miss Fortune (2) ability</li><li>Blitzcrank (2) ability</li>
      <li>Fixed an issue where Seraphine's ultimate follow-up timing was too slow after casting her (2) ability.</li>
      <li>Fixed an issue where Fiddlesticks' passive could still apply Fear while visible or in combat.</li>
      <li>Fixed an issue where the Attack Damage bonus from Darius's passive would disappear after his death.</li>
      <li>Fixed an issue where Lillia and Brand could not correctly trigger the slow from Rylai's Crystal Scepter.</li>
    </ul><h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><p>Mode-only adjustment.</p>
  `;
  for (const locale of ["en-us", "ru-ru"]) {
    const changes = parseChanges("7.2", locale, body);
    const fixes = changes.find((change) => change.entityKind === "system" && /BUG FIXES|ИСПРАВЛЕНИЯ ОШИБОК/i.test(change.sectionName));
    assert.ok(fixes);
    assert.equal(fixes.details.length, 8);
    assert.equal(fixes.details.some((detail) => /Mode-only|mode adjustment/i.test(detail.text)), false);
  }
});

test("filters nested Battlefest content without dropping general bug fixes", () => {
  const changes = parseChanges("6.3", "en-us", `
    <h1>BATTLEFEST SEASON 3</h1>
    <h2>New Gameplay</h2><h3>Unbound Frenzy</h3>
    <h4>New Champions</h4><h5>Poppy</h5><p>Mode-only champion changes.</p>
    <h2>AAA ARAM</h2><h3>New Items</h3><h4>Rite of Ruin</h4><p>Mode-only item stats.</p>
    <h2>Arena</h2><h3>New Item</h3><h4>Guinsoo's Rageblade</h4><p>Mode-only item stats.</p>
    <h2>Bug Fixes</h2><ul><li>Fixed a general Rift bug.</li></ul>
    <h2>SKINS</h2><ul><li>Superhero Vi</li></ul>
  `, skinChampionCatalog);

  const modeRows = changes.filter((change) => change.scope?.type === "game-mode");
  assert.ok(modeRows.length > 0);
  assert.equal(changes.some((change) => /Poppy|Rite of Ruin|Guinsoo/i.test(change.entityName) && change.scope?.type !== "game-mode"), false);
  const fixes = changes.find((change) => change.entityKind === "system" && change.sectionName === "Bug Fixes");
  assert.ok(fixes);
  assert.deepEqual(fixes.details.map((detail) => detail.text), ["Fixed a general Rift bug."]);
  assert.ok(changes.some((change) => change.entityKind === "skin" && /superhero vi/i.test(change.entityName)));
});

test("keeps every patch 7.2 non-mode system heading and its details separate in both locales", () => {
  const expected = [
    ["bounty-system-update", "Bounty System Update", "Изменения системы наград за голову"],
    ["ahri-asu", "Ahri VGU", "ВТО Ари"],
    ["soulflowers", "[Removed] Soulflowers", "[Удалено] Цветы души"],
    ["item-data-tracking-system", "Item data Tracking System", "Система отслеживания данных предметов"],
    ["end-of-match-system-improvements", "End-of-Match system Improvements", "Улучшения послеигровой статистики"],
    ["champion-select-screen-optimization", "Champion Select Screen Optimization", "Оптимизация экрана выбора чемпиона"],
    ["in-game-shop-interface-improvements", "In-Game Shop interface Improvements", "Улучшен интерфейс внутриигрового магазина"],
    ["damage-amplification-mechanic-update", "Damage Amplification Mechanic Update", "Обновлена механика увеличения урона"],
    ["seasonal-rift-update", "Seasonal Rift Update", "Новое время года в Ущелье"],
    ["vision-score-system", "Vision Score System", "Система показателя обзора"],
    ["champion-displacement-interrupt-rule-update", "Champion Displacement Interrupt Rule Update", "Обновление правил прерывания смещения чемпионов"],
    ["honorary-medal-system", "HONORARY MEDAL SYSTEM", "СИСТЕМА ПОЧЕТНЫХ МЕДАЛЕЙ"],
    ["omnichamp", "“Omnichamp”", "Знаток чемпионов"],
    ["violation-penalty", "VIOLATION PENALTY", "ШТРАФЫ ЗА НАРУШЕНИЯ"],
    ["auto-uninstallation-system", "Auto-uninstallation System", "Система автоматического удаления ресурсов"],
    ["highlights-auto-uninstallation-feature", "Highlights Auto-uninstallation Feature", "Функция автоматического удаления ярких моментов"],
    ["ranked-rules-for-sovereign-and-above", "RANKED RULES FOR SOVEREIGN AND ABOVE", "РАНГОВЫЕ ПРАВИЛА ДЛЯ РАНГА СУВЕРЕН И ВЫШЕ"],
    ["cache-cleanup", "CACHE CLEANUP", "ОЧИСТКА КЭША"],
    ["friendship-store", "FRIENDSHIP STORE", "МАГАЗИН ДРУЖБЫ"],
    ["matchmaking-champion-score-cap", "MATCHMAKING CHAMPION SCORE CAP", "МАКСИМУМ ОЧКОВ ЧЕМПИОНА ПРИ ПОДБОРЕ ИГРОКОВ"],
    ["ranked-reward", "RANKED REWARD", "РАНГОВЫЕ НАГРАДЫ"],
    ["stellacore-stats", "STELLACORE STATS", "ЗВЕЗДНЫЕ ЯДРА"],
    ["button-ui-skin-feature-optimization", "BUTTON UI SKIN FEATURE OPTIMIZATION", "ОПТИМИЗАЦИЯ ОБРАЗОВ КНОПОК"],
  ];
  const detailTexts = expected.map(([slug]) => `Verified detail for ${slug}.`);
  for (const [locale, nameIndex] of [["en-us", 1], ["ru-ru", 2]]) {
    const headings = expected.map((row, index) => {
      const bountyPart = row[0] === "bounty-system-update"
        ? locale === "en-us"
          ? "<h4>Positive Bounty</h4><p>Positive bounty formula detail.</p>"
          : "<h4>Положительные награды</h4><p>Подробности положительной награды.</p>"
        : "";
      return `<h3>${row[nameIndex]}</h3><p>${detailTexts[index]}</p>${bountyPart}`;
    }).join("\n");
    const tempo = locale === "en-us"
      ? "<h2>Battlefield Tempo Adjustments</h2><p>First battlefield tempo detail.</p><p>Second battlefield tempo detail.</p>"
      : "<h2>Изменения темпа матча</h2><p>Первая деталь темпа сражения.</p><p>Вторая деталь темпа сражения.</p>";
    const aramLoadout = locale === "en-us"
      ? "<h3>LOADOUT SYSTEM</h3><p>The new loadout is specific to ARAM.</p>"
      : "<h3>СИСТЕМА СНАРЯЖЕНИЯ</h3><p>Новый набор снаряжения предназначен только для ARAM.</p>";
    const changes = parseChanges("7.2", locale, `
      <h2>${locale === "en-us" ? "BATTLEFIELD ADJUSTMENTS" : "ИЗМЕНЕНИЯ НА ПОЛЕ БОЯ"}</h2>
      ${headings}
      ${tempo}
      ${aramLoadout}
      <h2>${locale === "en-us" ? "GAME MODE CHANGES" : "ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ"}</h2>
      <h3>AAA ARAM</h3><p>Mode-only detail must not be included.</p>
    `);
    for (const [index, [slug]] of expected.entries()) {
      const rows = changes.filter((change) => change.entityKind === "system" && change.entitySlug === slug);
      assert.equal(rows.length, 1, `${locale} should retain one independent row for ${slug}`);
      assert.equal(rows[0].details.some((detail) => detail.text === detailTexts[index]), true, `${locale} should retain ${slug} detail`);
      assert.equal(rows[0].details.some((detail) => /Mode-only detail/.test(detail.text)), false);
    }
    const bounty = changes.find((change) => change.entityKind === "system" && change.entitySlug === "bounty-system-update");
    assert.ok(bounty.details.some((detail) => /bounty formula|положительной награды/i.test(detail.text)));
    assert.ok(bounty.details.some((detail) => /Positive Bounty|Положительные награды/i.test(detail.component)));
    const ahri = changes.find((change) => change.entityKind === "system" && change.entitySlug === "ahri-asu");
    assert.equal(ahri.details.some((detail) => /battlefield tempo|темпа сражения/i.test(detail.text)), false);
    const tempoRow = changes.find((change) => change.entityKind === "system" && change.entitySlug === "battlefield-tempo-adjustments");
    assert.ok(tempoRow, `${locale} should retain the separate Battlefield Tempo row`);
    assert.deepEqual(tempoRow.details.map(({ text }) => text), locale === "en-us"
      ? ["First battlefield tempo detail.", "Second battlefield tempo detail."]
      : ["Первая деталь темпа сражения.", "Вторая деталь темпа сражения."]);
    assert.equal(changes.filter((change) => change.entityKind === "system"
      && (change.entitySlug === "battlefield-tempo-adjustments" || /battlefield tempo adjustments/i.test(change.entityName))).length, 1);
    assert.equal(changes.some((change) => change.entityKind === "system"
      && /loadout-system|система-снаряжения/.test(change.entitySlug || "")), false);
  }
});

test("filters explicitly mode-specific system notes without filtering unrelated augment notes", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>BUG FIXES</h2><ul>
      <li>Fixed an issue where augments could be switched in AAA ARAM champion select.</li>
      <li>Fixed an issue where an augment description was incorrect in Ranked.</li>
    </ul>
    <h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><p>Mode changes.</p>
  `);
  const systemRows = changes.filter((change) => change.entityKind === "system");
  const coreSystemRows = systemRows.filter((change) => change.scope?.type !== "game-mode");
  assert.equal(coreSystemRows.length, 1);
  assert.equal(systemRows.filter((change) => change.scope?.type === "game-mode").length, 1);
  assert.deepEqual(coreSystemRows[0].details.map(({ text }) => text), [
    "Fixed an issue where an augment description was incorrect in Ranked.",
  ]);
});

test("adds the two non-mode system changes from patch 7.1 in both locales", () => {
  const inputs = [
    ["en-us", `
      <h2>OTHER ADJUSTMENTS</h2>
      <h3>AUDIO UPGRADE</h3><p>We’ve added brand new kill and multi-kill sound effects.</p>
      <h3>JUNGLE MONSTER VISUAL UPDATE</h3><p>Jungle monster aggro is now displayed beneath their health bars.</p>
    `, ["Audio Upgrade", "Jungle Monster Visual Update"]],
    ["ru-ru", `
      <h2>ПРОЧИЕ ПРАВКИ</h2>
      <h3>УЛУЧШЕННЫЕ ЗВУКОВЫЕ ЭФФЕКТЫ</h3><p>Мы добавили новые звуковые эффекты убийств и многократных убийств.</p>
      <h3>ВИЗУАЛЬНОЕ ОБНОВЛЕНИЕ ЛЕСНЫХ МОНСТРОВ</h3><p>Агрессия лесных монстров отображается под шкалой здоровья.</p>
    `, ["Улучшенные звуковые эффекты", "Визуальное обновление лесных монстров"]],
  ];

  for (const [locale, body, names] of inputs) {
    const changes = parseChanges("7.1", locale, body);
    const futureChanges = parseChanges("9.0", locale, body);
    for (const name of names) {
      const normalizedName = name.toLocaleLowerCase(locale);
      const row = changes.find((change) => change.entityKind === "system"
        && change.entityName.toLocaleLowerCase(locale) === normalizedName);
      assert.ok(row, `${locale} should include ${name}`);
      assert.ok(futureChanges.some((change) => change.entityKind === "system"
        && change.entityName.toLocaleLowerCase(locale) === normalizedName), `${locale}: future parser missed ${name}`);
      assert.equal(row.details.length, 1);
      assert.match(row.details[0].text, /kill|убийств|aggro|агрессия/i);
    }
  }
});

test("does not turn a system fragment category heading into an entity row", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>OTHER ADJUSTMENTS</h2>
    <h3>Audio Upgrade</h3><p>New sound effects.</p>
  `, emptyCatalog, "OTHER ADJUSTMENTS");

  assert.equal(changes.filter((change) => change.entityKind === "system").length, 1);
  assert.equal(changes.some((change) => change.entityName === "Other Adjustments"), false);
  assert.equal(changes.find((change) => change.entityName === "Audio Upgrade")?.details[0].text, "New sound effects.");
});

test("preserves the five emoji-only minion notes in 7.0g and filters mode notes", () => {
  const inputs = [
    ["en-us", `
      <h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><p>🐶</p>
      <h2>GAMEPLAY CHANGES</h2>
      <h4>Melee Minion</h4><p>🔪🐶🛡️</p>
      <h4>Caster Minion</h4><p>🐶🪄</p>
      <h4>Cannon Minion</h4><h4>🚀🐶</h4><p>🛡️</p>
      <h4>Siege Minion</h4><h4>🚗🐶</h4><p>🔪🛡️🔪</p>
      <h4>Super Minion</h4><p>🛡️💪🐶🗡️</p>
      <p>📝 Note: After the update, all modes will be enabled.</p>
    `, ["Melee Minion", "Caster Minion", "Cannon Minion", "Siege Minion", "Super Minion"]],
    ["ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2><h3>AAA ARAM</h3><p>🐶</p>
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2>
      <h4>Миньон-воин</h4><p>🔪🐶🛡️</p>
      <h4>Миньон-маг</h4><p>🐶🪄</p>
      <h4>Миньон с пушкой</h4><h4>🚀🐶</h4><p>🛡️</p>
      <h4>Осадный миньон</h4><h4>🚗🐶</h4><p>🔪🛡️🔪</p>
      <h4>Суперминьон</h4><p>🛡️💪🐶🗡️</p>
      <p>📝 Примечание: после выхода обновления будут доступны все режимы.</p>
    `, ["Миньон-воин", "Миньон-маг", "Миньон с пушкой", "Осадный миньон", "Суперминьон"]],
  ];

  for (const [locale, body, names] of inputs) {
    const changes = parseChanges("7.0g", locale, body);
    const minionRows = changes.filter((change) => names.includes(change.entityName));
    const modeRows = changes.filter((change) => change.scope?.type === "game-mode");
    assert.equal(minionRows.length, 5);
    assert.ok(modeRows.some((change) => change.details.some((detail) => detail.text === "🐶")));
    assert.ok(minionRows.every((change) => change.sectionName === (locale === "ru-ru"
      ? "Изменения игрового процесса"
      : "GAMEPLAY CHANGES")));
    assert.deepEqual(minionRows.map((change) => change.details.map((detail) => detail.text)), locale === "ru-ru"
      ? [["🔪🐶🛡️"], ["🐶🪄"], ["🚀🐶", "🛡️"], ["🚗🐶", "🔪🛡️🔪"], ["🛡️💪🐶🗡️"]]
      : [["🔪🐶🛡️"], ["🐶🪄"], ["🚀🐶", "🛡️"], ["🚗🐶", "🔪🛡️🔪"], ["🛡️💪🐶🗡️"]]);
    assert.equal(parseChanges("9.0", locale, body).filter((change) => names.includes(change.entityName)).length, 5);
  }
});

test("recovers emoji-only minion rows with their Arena scope", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>Arena</h3>
    <h4>Melee Minion</h4><p>🔪🐶🛡️</p>
  `);

  const meleeMinion = changes.find((change) => change.entityKind === "system" && change.entityName === "Melee Minion");
  assert.ok(meleeMinion);
  assert.equal(meleeMinion.scope?.type, "game-mode");
  assert.deepEqual(meleeMinion.scope.modeSlugs, ["arena"]);
});

test("parses 7.2d champion loadout recommendations in both locales", () => {
  const inputs = [
    ["en-us", [
      ["Akali", "akali", ["Build 2: Stormsurge, Infinity Orb, Rabadon's Deathcap, Void Staff, Zhonya's Hourglass, Spellslinger's Shoes"]],
      ["Vladimir", "vladimir", [
        "Build 1: Hextech Rocketbelt, Riftmaker, Rabadon's Deathcap, Cryptbloom, Infinity Orb, Crimson Lucidity",
        "Build 2: Hextech Rocketbelt, Stormsurge, Rabadon's Deathcap, Void Staff, Infinity Orb, Spellslinger's Shoes",
        "Build 3: Cosmic Drive, Riftmaker, Rabadon's Deathcap, Void Staff, Zhonya's Hourglass, Spellslinger's Shoes",
      ]],
      ["Lee Sin", "leesin", [
        "Build 1: Trinity Force, Eclipse, Black Cleaver, Guardian Angel, Death's Dance, Armored Advance",
        "Build 2: Youmuu's Ghostblade, Trinity Force, Serpent's Fang, Serylda's Grudge, Guardian Angel, Immortal Treads",
        "Rune 3: Battle Zeal, Cut Down, Legend: Alacrity，Overgrowth",
      ]],
    ]],
    ["ru-ru", [
      ["Акали", "akali", ["Сборка 2: Штормовой прилив, Сфера бесконечности, Смертельная шляпа Рабадона, Посох Бездны, Песочные часы Жони, Сапоги заклинателя"]],
      ["Владимир", "vladimir", [
        "Сборка 1: Хекстековый ракетный ремень, Творец разломов, Смертельная шляпа Рабадона, Могильный цветок, Сфера бесконечности, Алое просветление",
        "Сборка 2: Хекстековый ракетный ремень, Штормовой прилив, Смертельная шляпа Рабадона, Посох Бездны, Сфера бесконечности, Сапоги заклинателя",
        "Сборка 3: Космический ускоритель, Творец разломов, Смертельная шляпа Рабадона, Посох Бездны, Песочные часы Жони, Сапоги заклинателя",
      ]],
      ["Ли Син", "leesin", [
        "Сборка 1: Тройственный Союз, Затмение, Черная секира, Ангел-хранитель, Танец смерти, Тяжелое наступление",
        "Сборка 2: Призрачный клинок Йомуу, Тройственный Союз, Змеиный клык, Злоба Серильды, Ангел-хранитель, Бессмертные шаги",
        "Руна 3: Боевое рвение, Реванш, Легенда: рвение, Разрастание",
      ]],
    ]],
  ];

  for (const [locale, expected] of inputs) {
    const champions = new Map(expected.map(([name, slug]) => [name.toLowerCase(), {
      slug,
      name: locale === "ru-ru" ? slug === "leesin" ? "Ли Син" : name : slug === "leesin" ? "Lee Sin" : name,
    }]));
    const body = expected.map(([name, , details]) => (
      `<p>${name}</p><p>${locale === "ru-ru" ? "Изменения сборки" : "Loadout Adjustments"}</p>`
      + `<ul>${details.map((detail) => `<li>${detail}</li>`).join("")}</ul><p>&nbsp;</p>`
    )).join("");
    const page = {
      url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-7-2d/`,
      blades: [
        { type: "articleMasthead", title: `Wild Rift Patch Notes 7.2d` },
        { type: "articleRichText", fragmentId: locale === "ru-ru" ? "Изменения сборки" : "Loadout Adjustments", richText: { body } },
      ],
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
    const changes = parsePatchArticle(html, "7.2d", locale, { ...emptyCatalog, champions }).changes;

    assert.equal(changes.length, expected.length);
    for (const [index, [name, slug, details]] of expected.entries()) {
      assert.equal(changes[index].entityKind, "champion");
      assert.equal(changes[index].entitySlug, slug);
      assert.equal(changes[index].entityName, locale === "ru-ru" ? name : slug === "leesin" ? "Lee Sin" : name);
      assert.equal(changes[index].changeName, locale === "ru-ru" ? "Изменения сборки" : "Loadout Adjustments");
      assert.deepEqual(changes[index].details.map(({ text }) => text), details);
    }
  }
});

test("parses 7.3 system sections in English and Russian while filtering mode rows", () => {
  const inputs = [
    ["en-us", "SYSTEM", [
      ["New Season Begins", "Evaluation system details.", "Adjusted the S/A rating algorithm."],
      ["Legendary Ranked", "Legendary Ranked details.", "Added the Legendary Trial event."],
      ["Champion Score System Update", "Champion Score details.", "Champion Record Score will no longer decrease after a loss."],
      ["Priority Role Bonus", "Priority role details.", "Support, Jungle, and Any Position are bonus roles."],
      ["Champion Ban Rule Adjustments", "Ban rule details.", "Ranked matches from Platinum through Diamond will change from 3 bans per team to 5 bans per team."],
      ["Teammate Augment Recommendation", "Ask premade teammates for Augment recommendations."],
      ["New Player Rewards Revamped", "New Player Login and Special Offer events now share one interface."],
    ]],
    ["ru-ru", "ИГРОВЫЕ СИСТЕМЫ", [
      ["Новый сезон начинается", "Подробности системы оценки.", "Изменен алгоритм оценки S/A."],
      ["Легендарная очередь", "Подробности легендарной очереди.", "Добавлено событие легендарного испытания."],
      ["Обновление системы очков чемпиона", "Подробности об очках чемпиона.", "Счетчик побед за чемпиона больше не будет уменьшаться после поражения."],
      ["Бонус приоритетной роли", "Подробности бонуса приоритетной роли.", "Бонусные роли: поддержка, лес и любая позиция."],
      ["Изменения правил блокировок чемпионов", "Подробности правил блокировок.", "В ранговых матчах с Платины до Алмаза количество блокировок на команду увеличится с 3 до 5."],
      ["Рекомендации по выбору аугментации от союзников", "Можно попросить игроков из своей группы рекомендовать аугментацию."],
      ["Изменение наград для новых игроков", "Награды за вход и особые предложения теперь находятся в одном интерфейсе."],
    ]],
  ];

  for (const [locale, systemHeading, expected] of inputs) {
    const section = ([heading, description, detail]) => (
      `<h3>${heading}</h3><p>${description}</p>${detail ? `<ol><li>${detail}</li></ol>` : ""}`
    );
    const body = `
      <h2>${locale === "ru-ru" ? "ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ" : "GAME MODE CHANGES"}</h2>
      <h3>AAA ARAM</h3><p>Mode-only update.</p>
      <h2>${systemHeading}</h2><h3>${locale === "ru-ru" ? "НОВАЯ СИСТЕМА" : "NEW SYSTEM"}</h3>
      ${expected.map(([heading, description, detail], index) => {
        const isRussianNestedSection = locale === "ru-ru" && [2, 3].includes(index);
        return isRussianNestedSection
          ? `<p>${heading}</p><p>${description}</p>${detail ? `<ol><li>${detail}</li></ol>` : ""}`
          : section([heading, description, detail]);
      }).join("")}
    `;
    const changes = parseChanges("7.3", locale, body);
    const systemRows = changes.filter((change) => change.entityKind === "system" && change.scope?.type !== "game-mode");

    assert.equal(systemRows.length, 7, `${locale}: ${systemRows.map(({ entityName }) => entityName).join(" | ")}`);
    assert.equal(changes.some((change) => /AAA ARAM|Mode-only/i.test(change.entityName || "") && change.scope?.type !== "game-mode"), false);
    assert.equal(changes.filter((change) => change.scope?.type === "game-mode").length, 1);
    assert.deepEqual(systemRows.map(({ entityName, details }) => [entityName, ...details.map(({ text }) => text)]), expected);
  }
});

test("keeps the non-mode bug fixes from 7.1h, 7.1g, and 7.1e in each locale", () => {
  const inputs = [
    ["7.1h", "en-us", [
      "Fixed an issue where Quicksilver Enchant could not remove the crowd control effects from Thresh’s (1) ability and Nami’s (1) ability.",
    ]],
    ["7.1h", "ru-ru", [
      'Исправлена ошибка, из-за которой зачарование "Живое серебро" не снимало эффекты контроля от умения (1) Треша и умения (1) Нами.',
    ]],
    ["7.1g", "en-us", [
      "Fixed a bug where the description for the item Navori Quickblades was incorrect.",
      "Fixed a bug where the item Hullbreaker would continue to buff nearby minions after its owner died.",
    ]],
    ["7.1g", "ru-ru", [
      "Исправлена ошибка, из-за которой описание Быстрых клинков Навори отображалось некорректно.",
      "Исправлена ошибка, из-за которой Бортолом продолжал усиливать миньонов поблизости даже после гибели владельца.",
    ]],
    ["7.1e", "en-us", [
      "Fixed an incorrect description for the Ixtal Seedjar rune.",
      "Fixed an issue where Sett’s (1) ability dealt incorrect damage.",
    ]],
    ["7.1e", "ru-ru", [
      'Исправлено некорректное описание руны "Банка для семян".',
      "Исправлена ошибка, из-за которой первое умение Сетта наносило некорректный урон.",
    ]],
  ];

  for (const [version, locale, expected] of inputs) {
    const heading = locale === "ru-ru" ? "ИСПРАВЛЕНИЕ ОШИБОК" : "BUG FIXES";
    const text = expected.map((line) => `<li>${line}</li>`).join("");
    const changes = parseChanges(version, locale, `<h2>${heading}</h2><ul>${text}</ul>`);
    const rows = changes.filter((change) => change.entityKind === "system");
    assert.ok(rows.length >= 1, `${version} ${locale} should have bug-fix rows`);
    assert.deepEqual(rows.flatMap(({ details }) => details.map(({ text: detail }) => detail))
      .filter((detail) => /^(?:Fixed|Исправлен|Исправлено)/.test(detail)), expected);
  }
});

test("preserves all 13 general bug fixes from patch 7.1f in both locales", () => {
  const inputs = [
    ["en-us", [
      "Fixed an issue where the Close Friend system displayed values on the client that did not match the actual increase amount.",
      "Fixed an issue where the Honor info button disappeared after swapping roles during Champion Select.",
      "Fixed an issue where the entry to like teammates disappeared after swapping roles.",
      "Fixed an issue where clicking expired items in mail caused an error.",
      "Fixed an issue where iOS devices could crash after multiple consecutive matches.",
      "Optimized stuttering during battlefield loading.",
      "Improved device overheating issues.",
      'Temporary workaround: Lower graphics quality and resolution in Settings, disable Highlights (“Settings → Replay”), and disable mobile and wifi Mode (“Settings → Other → Network Optimization”).',
      "Reduced power consumption from the animated emote interface.",
      "Reduced power consumption from in-game environment assets.",
      "Optimized in-game stuttering issues affecting some mid-to-high-end Android devices.",
      "Optimized in-game stuttering issues affecting lower-end devices.",
      "Optimized an issue causing some players to crash after matchmaking succeeded.",
    ]],
    ["ru-ru", [
      "Исправлена ошибка, из-за которой в системе близких друзей в клиенте игры отображались некорректные данные.",
      "Исправлена ошибка, из-за которой кнопка уровня чести исчезала при смене роли во время выбора чемпиона.",
      "Исправлена ошибка, из-за которой окно похвалы союзников исчезало при смене роли.",
      "Исправлена ошибка, из-за которой в почтовом ящике при нажатии на предметы, чей срок действия истек, происходила ошибка.",
      "Исправлена ошибка, из-за которой на устройствах iOS игра вылетала после нескольких матчей подряд.",
      "Повышена плавность загрузки поля боя.",
      "Уменьшен перегрев устройства.",
      'Временное решение: снизить разрешение и качество графики в настройках, отключить яркие моменты ("Настройки" → "Повтор"), а также отключить режим двухканальной связи ("Настройки" → "Другое" → "Оптимизация подключения к сети").',
      "Уменьшено потребление энергии интерфейсом анимированных эмоций.",
      "Уменьшено потребление энергии файлами, связанными с игровым окружением.",
      "Повышена плавность работы игры на устройствах Android среднего и высокого ценового сегмента.",
      "Повышена плавность работы игры на менее мощных устройствах.",
      "Исправлена ошибка, из-за которой на некоторых устройствах игра вылетала после подбора игроков.",
    ]],
  ];

  for (const [locale, expected] of inputs) {
    const heading = locale === "ru-ru" ? "ИСПРАВЛЕНИЕ ОШИБОК" : "BUG FIXES";
    const modeHeading = locale === "ru-ru" ? "ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ" : "GAME MODE CHANGES";
    const changes = parseChanges("7.1f", locale, `
      <h2>${heading}</h2><ul>${expected.map((line) => `<li>${line}</li>`).join("")}</ul>
      <h2>${modeHeading}</h2><h3>${locale === "ru-ru" ? "АРЕНА" : "AAA ARAM"}</h3><p>Mode-only fix.</p>
    `);
    const rows = changes.filter((change) => change.entityKind === "system" && change.scope?.type !== "game-mode");
    assert.equal(rows.length, 1);
    assert.ok(changes.some((change) => change.scope?.type === "game-mode"));
    assert.deepEqual(rows[0].details.map(({ text }) => text), expected);
  }
});

test("parses jungle monster entities and preserves article stat wording", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>JUNGLE CHANGES</h2><h3>Red Brambleback</h3>
    <p>Burn damage to champions: 6–34 → 5–15 (scales starting at level 6).</p>
    <p>Burn damage to non-champions: 3–17 → 5–15 (scales starting at level 6).</p>
  `);
  const brambleback = changes.find((change) => change.entityKind === "system" && change.entitySlug === "red-brambleback");
  assert.ok(brambleback);
  assert.equal(brambleback.details.length, 2);
  assert.ok(brambleback.details.every(({ after, text }) => /scales starting at level 6/i.test(`${after} ${text}`)));
  assert.ok(brambleback.details.every(({ text }) => !/at all levels/i.test(text)));
});

test("localizes 7.1 champion and skin sections and keeps official skin release dates", () => {
  const champions = new Map([
    ["taliyah", { slug: "taliyah", name: "Taliyah", aliases: ["Taliyah", "Талия"] }],
    ["aatrox", { slug: "aatrox", name: "Aatrox", aliases: ["Aatrox", "Атрокс"] }],
    ["k sante", { slug: "ksante", name: "K'Sante", aliases: ["K'Sante", "K’Sante", "К'Санте"] }],
    ["norra", { slug: "norra", name: "Norra", aliases: ["Norra", "Норра"] }],
    ["aurora", { slug: "aurora", name: "Aurora", aliases: ["Aurora", "Аврора"] }],
    ["sion", { slug: "sion", name: "Sion", aliases: ["Sion", "Сион"] }],
    ["samira", { slug: "samira", name: "Samira", aliases: ["Samira", "Самира"] }],
    ["hecarim", { slug: "hecarim", name: "Hecarim", aliases: ["Hecarim", "Гекарим"] }],
    ["irelia", { slug: "irelia", name: "Irelia", aliases: ["Irelia", "Ирелия"] }],
    ["zed", { slug: "zed", name: "Zed", aliases: ["Zed", "Зед"] }],
    ["gragas", { slug: "gragas", name: "Gragas", aliases: ["Gragas", "Грагас"] }],
    ["kaisa", { slug: "kaisa", name: "Kai'Sa", aliases: ["Kai'Sa", "Kai’Sa", "Кай'Са", "Кай’Са"] }],
  ]);
  const catalog = { ...emptyCatalog, champions };

  const characterPage = (version, locale) => {
    const page = {
      url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-${version}/`,
      blades: [
        { type: "articleMasthead", title: `Wild Rift Patch Notes ${version}` },
        { type: "characterChanges", characters: [{
          character: { name: locale === "ru-ru" ? "Талия" : "Taliyah" },
          changes: [{ title: "Nerf", description: { body: "<ul><li>Damage: 100 → 90</li></ul>" } }],
        }] },
      ],
    };
    return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { page } } })}</script>`;
  };
  for (const version of ["7.1d", "7.1e", "7.1f", "7.1g", "7.1h"]) {
    for (const locale of ["en-us", "ru-ru"]) {
      const champion = parsePatchArticle(characterPage(version, locale), version, locale, catalog).changes
        .find((change) => change.entityKind === "champion");
      assert.equal(champion.sectionName, locale === "ru-ru" ? "ИЗМЕНЕНИЯ ЧЕМПИОНОВ" : "Champions");
    }
  }

  const patch71hTaliyah = parseChanges("7.1h", "en-us", `
    <h2>CHAMPION CHANGES</h2><h3>Taliyah</h3>
    <h4>Base Stats</h4><ul><li>Movement Speed: 355 → 350</li></ul>
    <h4>Rock Surfing</h4><ul><li>Movement Speed: 10%/15%/25%/40% → 5%/10%/20%/35%</li></ul>
    <h4>Threaded Volley</h4><ul><li>Cooldown reduction on Worked Ground: 50% → 30%</li></ul>
  `, catalog).find((change) => change.entityKind === "champion" && /taliyah/i.test(change.entityName));
  assert.equal(patch71hTaliyah.changeName, "Base Stats");
  assert.deepEqual(patch71hTaliyah.details.map(({ component }) => component), ["Base Stats", "Rock Surfing", "Threaded Volley"]);

  const patch71fKsante = parseChanges("7.1f", "en-us", `
    <h2>CHAMPION CHANGES</h2><h3>K'Sante</h3><h4>All Out</h4>
    <ul><li>Max Health lost: 25% → 30%</li><li>Bonus Armor lost: 70% → 80%</li></ul>
  `, catalog).find((change) => change.entityKind === "champion" && /k.?sante/i.test(change.entityName));
  assert.equal(patch71fKsante.changeName, "All Out");
  assert.ok(patch71fKsante.details.every(({ component }) => component === "All Out"));

  const englishSkins = [
    ["7.1g", "Mecha Aatrox Exquisite Edition Aatrox", "June 05", "aatrox"],
    ["7.1g", "Plant Protector Sion", "June 12", "sion"],
    ["7.1g", "Ashen Avenger Samira", "June 12", "samira"],
    ["7.1e", "Pool Party Taliyah", "May 15", "taliyah"],
    ["7.1e", "Cafe Cuties Norra", "May 20", "norra"],
    ["7.1d", "Neon Daredevil Kai'Sa", "April 30", "kaisa"],
    ["7.1d", "Neon Daredevil Hecarim", "April 30", "hecarim"],
    ["7.1d", "Neon Daredevil Irelia", "April 30", "irelia"],
    ["7.1d", "Neon Daredevil Aurora", "April 30", "aurora"],
    ["7.1d", "Neon Daredevil Zed", "April 30", "zed"],
    ["7.1d", "Neon Daredevil Gragas", "April 30", "gragas"],
    ["7.1d", "Prestige Select Neon Daredevil Kai'Sa", "April 30", "kaisa"],
  ];
  const skinInputs = englishSkins.flatMap(([version, title, date, champion]) => [
    [version, "en-us", `${title} Releasing ${date} @ 00:01 UTC`, `Releasing ${date} @ 00:01 UTC`, champion],
    [version, "ru-ru", `${title} Появится в игре ${date === "June 05" ? "5 июня" : date === "June 12" ? "12 июня" : date === "May 15" ? "15 мая" : date === "May 20" ? "20 мая" : "30 апреля"} в 03:01 по московскому времени`, `Появится в игре ${date === "June 05" ? "5 июня" : date === "June 12" ? "12 июня" : date === "May 15" ? "15 мая" : date === "May 20" ? "20 мая" : "30 апреля"} в 03:01 по московскому времени`, champion],
  ]);
  for (const [version, locale, caption, expectedDate, champion] of skinInputs) {
    const heading = locale === "ru-ru" ? "ОБЛИКИ" : "SKINS";
    const skins = parseChanges(version, locale, `<h2>${heading}</h2><p>${caption}</p>`, catalog)
      .filter((change) => change.entityKind === "skin");
    assert.equal(skins.length, 1, `${version} ${locale} should parse ${caption}`);
    assert.equal(skins[0].details[0].text, expectedDate);
    assert.equal(skins[0].sectionName, locale === "ru-ru" ? "Облики патча" : "SKINS");
    assert.equal(skins[0].sourceChampionSlug, champion);
  }

  const localizedEnglishSkin = parseChanges("7.1e", "en-us", `
    <h2>Облики</h2><p>Pool Party Taliyah</p>
  `, catalog).find((change) => change.entityKind === "skin");
  assert.equal(localizedEnglishSkin.sectionName, "SKINS");
});

test("keeps official 7.1 and 7.1d skin release captions from Riot table markup", () => {
  const champions = new Map([
    ["viego", { slug: "viego", name: "Viego", aliases: ["Viego", "Виего"] }],
    ["senna", { slug: "senna", name: "Senna", aliases: ["Senna", "Сенна"] }],
    ["ambessa", { slug: "ambessa", name: "Ambessa", aliases: ["Ambessa", "Амбесса"] }],
    ["viktor", { slug: "viktor", name: "Viktor", aliases: ["Viktor", "Виктор"] }],
    ["varus", { slug: "varus", name: "Varus", aliases: ["Varus", "Варус"] }],
    ["kaisa", { slug: "kaisa", name: "Kai'Sa", aliases: ["Kai'Sa", "Kai’Sa", "Кай'Са", "Кай’Са"] }],
    ["hecarim", { slug: "hecarim", name: "Hecarim", aliases: ["Hecarim", "Гекарим"] }],
    ["irelia", { slug: "irelia", name: "Irelia", aliases: ["Irelia", "Ирелия"] }],
    ["aurora", { slug: "aurora", name: "Aurora", aliases: ["Aurora", "Аврора"] }],
    ["zed", { slug: "zed", name: "Zed", aliases: ["Zed", "Зед"] }],
    ["gragas", { slug: "gragas", name: "Gragas", aliases: ["Gragas", "Грагас"] }],
  ]);
  const catalog = { ...emptyCatalog, champions };
  const articleImage = (hash) => `https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/${hash}-1920x1080.jpg`;
  const soulFighterRows = [
    ["viego", "Soul Fighter Viego", "Боевая душа Виего", "f31d4b03f7ae81091282528bae1e2a3c134aab50"],
    ["senna", "Soul Fighter Senna", "Боевая душа Сенна", "bce6372e31a55871f16847cbbc6c47b3bb31c564"],
    ["ambessa", "Soul Fighter Ambessa", "Боевая душа Амбесса", "62bdd81521c5334586b3adc6bf6525ba63bf05d5"],
    ["viktor", "Soul Fighter Viktor", "Боевая душа Виктор", "70724c3ec49172b9cd670a715c68b51ec0daebfb"],
    ["varus", "Soul Fighter Varus", "Боевая душа Варус", "6965e72cedf3aba85bfd435a71be9154f2337277"],
  ];
  const neonRows = [
    ["kaisa", "Neon Daredevil Kai’Sa", "Неоновая сорвиголова Кай'Са", "330ca33151570c73c47917f0c35c3fddd8544dc4"],
    ["hecarim", "Neon Daredevil Hecarim", "Неоновый сорвиголова Гекарим", "43480500d96727af044a5febc97dc0a9c7cff2f6"],
    ["irelia", "Neon Daredevil Irelia", "Неоновая сорвиголова Ирелия", "fc841cca3589bcbb8c4a1bd1f15d20d0f2abc3cb"],
    ["aurora", "Neon Daredevil Aurora", "Неоновая сорвиголова Аврора", "b2cff22dec457fac1b93870c0682399b030d79d5"],
    ["zed", "Neon Daredevil Zed", "Неоновый сорвиголова Зед", "ff99a430475c9aa479ee65d73d47be2a8a1d5417"],
    ["gragas", "Neon Daredevil Gragas", "Неоновый сорвиголова Грагас", "53a22dd752f7b3c0333dd67b48f26e6924cb21a9"],
    ["kaisa", "Prestige Select Neon Daredevil Kai’Sa", "Избранная Неоновая сорвиголова Кай'Са (престижное издание)", "299ada88515e5b331c373346d3b3f40efecb9fe8"],
  ];
  const skinCell = (image, title, releaseCaption, formatting = "plain") => {
    const titleMarkup = formatting.includes("italic-meta-title") ? `<meta><i>${title}</i>`
      : formatting.includes("meta-title") ? `<meta>${title}`
        : formatting.includes("italic-title") ? `<i>${title}</i>` : title;
    const blankCaption = formatting.includes("blank-meta") ? "<p style=\"text-align:center;\"><meta></p>" : "";
    const releaseMarkup = formatting.includes("meta-release") ? `<meta><i>${releaseCaption}</i>` : `<i>${releaseCaption}</i>`;
    return `<td colspan="1" rowspan="1"><p><img src="${image}" width="1920" height="1080"></p><p style="text-align:center;">${titleMarkup}</p>${blankCaption}<p style="text-align:center;">${releaseMarkup}</p></td>`;
  };
  const skinTable = (rows) => `<h2>SKINS</h2><figure class="table"><div class="table-wrapper"><table><tbody>${rows.map((cell) => `<tr>${cell}</tr>`).join("")}</tbody></table></div></figure>`;
  const localizedInputs = [
    {
      version: "7.1", locale: "en-us", rows: soulFighterRows.map(([, en, , image]) =>
        skinCell(articleImage(image), en, "Releasing April 09 @ 00:01 UTC")),
      names: soulFighterRows.map(([, en]) => en), release: "Releasing April 09 @ 00:01 UTC",
    },
    {
      version: "7.1", locale: "ru-ru", rows: soulFighterRows.map(([, , ru, image]) =>
        skinCell(articleImage(image), ru, "Появится в игре 9&nbsp;апреля в 03:01 по московскому времени")),
      names: soulFighterRows.map(([, , ru]) => ru), release: "Появится в игре 9 апреля в 03:01 по московскому времени",
    },
    {
      version: "7.1d", locale: "en-us", rows: neonRows.map(([, en, , image], index) =>
        skinCell(articleImage(image), en, "Releasing April 30 @ 00:01 UTC", ["plain", "meta-title blank-meta", "meta-title meta-release", "italic-meta-title blank-meta", "meta-title blank-meta", "italic-meta-title blank-meta", "plain"][index])),
      names: neonRows.map(([, en]) => en), release: "Releasing April 30 @ 00:01 UTC",
    },
    {
      version: "7.1d", locale: "ru-ru", rows: neonRows.map(([, , ru, image], index) =>
        skinCell(articleImage(image), ru, "Появится в игре 30 апреля в 03:01 по московскому времени", ["plain", "plain blank-meta", "plain", "italic-title blank-meta", "plain blank-meta", "italic-title blank-meta", "plain"][index])),
      names: neonRows.map(([, , ru]) => ru), release: "Появится в игре 30 апреля в 03:01 по московскому времени",
    },
  ];

  for (const { version, locale, rows, names, release } of localizedInputs) {
    const heading = locale === "ru-ru" ? "ОБЛИКИ" : "SKINS";
    const changes = parseChanges(version, locale, skinTable(rows).replace("<h2>SKINS</h2>", `<h2>${heading}</h2>`), catalog)
      .filter(({ entityKind }) => entityKind === "skin");
    assert.equal(changes.length, names.length, `${version} ${locale} skin count`);
    for (const name of names) {
      const skin = changes.find(({ entityName }) => entityName === name);
      assert.ok(skin, `${version} ${locale} parses ${name}`);
      assert.equal(skin.details[0].text, release, `${name} release caption`);
    }
  }
});

test("uses image-backed skin tables for full titles and tolerates a unique champion-name typo", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["zed", { slug: "zed", name: "Zed", aliases: ["Zed"] }],
      ["lee sin", { slug: "lee-sin", name: "Lee Sin", aliases: ["Lee Sin"] }],
      ["twitch", { slug: "twitch", name: "TWITCH", aliases: ["TWITCH"] }],
      ["singed", { slug: "singed", name: "SINGED", aliases: ["SINGED"] }],
    ]),
  };
  const cell = (title, image) => `<td><p>${title}</p><p><em>Releasing January 1 @ 00:01 UTC</em></p><img src="https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/${image}.jpg"></td>`;
  const changes = parseChanges("6.3f", "en-us", `
    <h2>SKINS</h2><table><tbody>
      <tr>${cell("Galaxy Slayer Zed Exquisite Edition", "zed")}${cell("Spirit Blossom Lee Sin Exquisite Edition", "lee-sin")}</tr>
      <tr>${cell("Chromacrash Twitch", "twitch")}${cell("Chromacrash Signed", "singed")}</tr>
    </tbody></table>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");

  assert.deepEqual(changes.map(({ entityName }) => entityName), [
    "Galaxy Slayer Zed Exquisite Edition",
    "Spirit Blossom Lee Sin Exquisite Edition",
    "Chromacrash Twitch",
    "Chromacrash Singed",
  ]);
  assert.ok(changes.every(({ sourceImageUrl }) => sourceImageUrl));

  const uppercaseChampion = parseChanges("6.3f", "en-us", `
    <h2>SKINS</h2><table><tbody><tr>${cell("Chromacrash SINGED", "singed")}</tr></tbody></table>
  `, catalog).find(({ entitySlug }) => entitySlug === "singed-chromacrash-singed");
  assert.equal(uppercaseChampion?.entityName, "Chromacrash Singed");
});

test("keeps chroma loot, availability, and price details on one family row", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([[
      "volibear",
      { slug: "volibear", name: "Volibear", nameLocalizations: { "ru-ru": "Волибир" }, aliases: ["Volibear", "Волибир"] },
    ]]),
  };
  const parsed = parsePatchArticle(riot73bArticle, "7.3b", "en-us", catalog);
  const skinRows = parsed.changes.filter(({ entityKind }) => entityKind === "skin");
  const family = skinRows.find(({ entityName }) => /legends showdown volibear chromas/i.test(entityName));
  const variants = skinRows.filter(({ entityName }) => /legends showdown volibear (?:lpl|lck|lec|cblol|lcs|lcp)$/i.test(entityName));

  assert.ok(family, "the base skin/chroma family remains available for the UI group");
  assert.equal(skinRows.length, 7, "chest announcements must not become a duplicate skin row");
  assert.equal(variants.length, 6);
  for (const expected of [
    "5.83%", "11.07%", "27.74%", "33.22%", "22.14%",
    "Availability: After the patch update on October 15, 2026, through January 6, 2027, at 11:59 PM.",
    "purchase limit of 10 per transaction and 60 total",
    "120 Wild Cores + 970 Dreamchaser Badge",
  ]) {
    assert.ok(family.details.some(({ text }) => text.includes(expected)), `family details include ${expected}`);
  }
});

test("restores every 7.1 skin announced across the official patch sections", () => {
  const skinsByLocale = new Map([
    ["en-us", [
      "Glorious Eminence Jax", "Soul Fighter Varus", "Ascended Soul Fighter Varus", "Hexplorer Galio",
      "Supervillain Graves", "Ascended Supervillain Graves", "Superhero Vi", "Ascended Superhero Vi",
      "Dream Raider Nasus", "Ascended Dream Raider Nasus", "Pajama Guardian Lulu", "Choo-Choo Ornn",
      "Choo-Choo Ornn (Yellow)", "Cyber Pop Zoe", "Psy Ops Master Yi (Special Edition)", "Soul Fighter Viego",
      "Soul Fighter Senna", "Soul Fighter Ambessa", "Soul Fighter Viktor",
    ]],
    ["ru-ru", [
      "Блистательная знаменитость Джакс", "Боевая душа Варус", "Вознесшаяся Боевая душа Варус",
      "Защитник хекспедиции Галио", "Суперзлодей Грейвз", "Вознесшийся Суперзлодей Грейвз",
      "Супергероиня Вай", "Вознесшаяся Супергероиня Вай", "Похититель снов Насус",
      "Вознесшийся Похититель снов Насус", "Защитница в пижаме Лулу", "Машинист Орн",
      "Машинист Орн (желтый)", "Киберпоп-Зои", "Мастер Йи из Пси-отряда (особое издание)",
      "Боевая душа Виего", "Боевая душа Сенна", "Боевая душа Амбесса", "Боевая душа Виктор",
    ]],
  ]);
  const sourceNames = {
    "en-us": [
      "Glorious Eminence Jax", "new skin Soul Fighter Varus", "Ascended Soul Fighter Varus",
      "Hexplorer Galio", "Supervillain Graves", "Ascended Supervillain Graves", "Superhero Vi",
      "Ascended Superhero Vi", "Dream Raider Nasus", "Ascended Dream Raider Nasus", "Pajama Guardian Lulu",
      "Choo-Choo Ornn", "Choo-Choo Ornn (Yellow)", "Cyber Pop Zoe", "Psy Ops Master Yi (Special Edition)",
      "Soul Fighter Viego", "Soul Fighter Senna", "Soul Fighter Ambessa", "Soul Fighter Viktor",
    ],
    "ru-ru": [
      "Блистательная знаменитость Джакс", "Боевая душа Варус", "Вознесшаяся Боевая душа Варус",
      "Защитник Хекспедиции Галио", "Суперзлодей Грейвз", "Вознесшийся Суперзлодей Грейвз",
      "Супергероиня Вай", "Вознесшаяся Супергероиня Вай", "Похититель снов Насус",
      "Вознесшийся Похититель снов Насус", "Защитница в пижаме Лулу", "Машинист Орн",
      "Машинист Орн (желтый)", "Киберпоп Зои", "Мастер Йи из Пси-отряда (особое издание)",
      "Боевая душа Виего", "Боевая душа Сенна", "Боевая душа Амбесса", "Боевая душа Виктор",
    ],
  };
  for (const [locale, expectedNames] of skinsByLocale) {
    const heading = locale === "ru-ru" ? "ОБЛИКИ" : "SKINS";
    const newNames = locale === "ru-ru"
      ? ["Блистательная знаменитость Джакс", "Боевая душа Варус", "Вознесшаяся Боевая душа Варус", "Киберпоп-Зои", "Боевая душа Виего", "Боевая душа Сенна", "Боевая душа Амбесса", "Боевая душа Виктор"]
      : ["Glorious Eminence Jax", "new skin Soul Fighter Varus", "Ascended Soul Fighter Varus", "Cyber Pop Zoe", "Soul Fighter Viego", "Soul Fighter Senna", "Soul Fighter Ambessa", "Soul Fighter Viktor"];
    const returningNames = locale === "ru-ru"
      ? ["Защитник Хекспедиции Галио", "Суперзлодей Грейвз", "Вознесшийся Суперзлодей Грейвз", "Супергероиня Вай", "Вознесшаяся Супергероиня Вай", "Похититель снов Насус", "Вознесшийся Похититель снов Насус", "Защитница в пижаме Лулу"]
      : ["Hexplorer Galio", "Supervillain Graves", "Ascended Supervillain Graves", "Superhero Vi", "Ascended Superhero Vi", "Dream Raider Nasus", "Ascended Dream Raider Nasus", "Pajama Guardian Lulu"];
    const availableNames = locale === "ru-ru" ? ["Машинист Орн", "Машинист Орн (желтый)"] : ["Choo-Choo Ornn", "Choo-Choo Ornn (Yellow)"];
    const masterYi = sourceNames[locale].find((name) => /(?:master yi|мастер йи)/i.test(name));
    const body = `<h2>${heading}</h2><h3>${locale === "ru-ru" ? "Новые облики" : "New Skins"}</h3><ul>${newNames.map((name) => `<li>${name}</li>`).join("")}</ul>`
      + `<h3>${locale === "ru-ru" ? "Повторные облики" : "Returning Skins"}</h3><ul>${returningNames.map((name) => `<li>${name}</li>`).join("")}</ul>`
      + `<h3>${locale === "ru-ru" ? "Облики" : "Skins"}</h3><ul>${[...availableNames, masterYi].map((name) => `<li>${name}</li>`).join("")}</ul>`;
    const changes = parseChanges("7.1", locale, body, skinChampionCatalog);
    const skins = changes.filter(({ entityKind }) => entityKind === "skin");
    assert.equal(skins.length, 19, `${locale}: ${skins.map(({ entityName, entitySlug, changeName }) => `${entityName} (${entitySlug}, ${changeName})`).join(" | ")}`);
    assert.deepEqual(new Set(skins.map(({ entityName }) => entityName)), new Set(expectedNames), locale);
    const ascendedVarus = skins.find(({ entityName }) => /ascended soul fighter varus|вознесшаяся боевая душа варус/i.test(entityName));
    assert.equal(ascendedVarus.entitySlug, "varus-ascended-soul-fighter-varus", locale);
    assert.equal(skins.find(({ entityName }) => entityName === (locale === "ru-ru"
      ? "Мастер Йи из Пси-отряда (особое издание)" : "Psy Ops Master Yi (Special Edition)"))?.sourceChampionSlug, "master-yi");
    assert.equal(skins.filter(({ changeName }) => changeName === "new").length, 10, `${locale}: ${skins.map(({ entityName, changeName }) => `${entityName}=${changeName}`).join(" | ")}`);
    assert.equal(skins.filter(({ changeName }) => changeName === "returning").length, 8, locale);
    assert.equal(skins.filter(({ changeName }) => changeName === "available").length, 1, locale);
    assert.equal(skins.filter(({ changeName }) => changeName === null).length, 0, locale);
    assert.ok(skins.filter(({ changeName }) => changeName === "returning").every(({ sectionName }) =>
      sectionName === (locale === "ru-ru" ? "Повторные облики" : "Returning Skins")));
    assert.ok(skins.filter(({ changeName }) => changeName !== "returning").every(({ sectionName }) =>
      sectionName === (locale === "ru-ru" ? "Облики патча" : "SKINS")));
  }
});

test("parses the 6.1c mode subsections as scoped augment and champion changes", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["vex", { slug: "vex", name: "Vex", nameLocalizations: { en_us: "Vex", ru_ru: "Векс" } }],
    ]),
  };
  const changes = parseChanges("6.1c", "en-us", `
    <h2>GAME MODE CHANGES</h2>
    <h3>AAA ARAM &amp; ARAM</h3>
    <h4>Augment Changes</h4><h5>Soul Siphon</h5><p>Heal: 10% → 15%.</p>
    <h4>Champion Changes</h4><h5>Vex</h5><p>Damage: 100 → 90.</p>
    <h3>Arena</h3><h4>New Augments</h4><h5>Chaos Missile</h5><p>New augment description.</p>
  `, catalog);
  const scopedRows = changes.filter((change) => change.scope?.type === "game-mode");

  assert.ok(scopedRows.some((change) => change.entityKind === "augment"
    && change.entityName === "Soul Siphon"
    && change.scope.modeSlugs.join(",") === "aaa-aram,aram"));
  assert.ok(scopedRows.some((change) => change.entityKind === "champion"
    && change.entitySlug === "vex"
    && change.entityName === "Vex"
    && change.scope.modeSlugs.join(",") === "aaa-aram,aram"));
  assert.ok(scopedRows.some((change) => change.entityKind === "augment"
    && change.entityName === "Chaos Missile"
    && change.changeName === "new"
    && change.scope.modeSlugs.includes("arena")));
});

test("parses legacy GAMEMODES and ARURF spell mechanics as scoped system changes", () => {
  const text = "[NEW] If you would reduce an Epic monster to 800 health or below, or a large monster to 400 health or below, execute the monster and restore 8% of your maximum health.";
  const parsed = parsePatchArticle(articleHtml("4.0", "en-us", `
    <h2>NEW</h2><h3>NEW FEATURES</h3><h3>GAMEMODES</h3>
    <h4>ALL RANDOM ULTRA RAPID FIRE MODE (ARURF)</h4><h4>EXECUTE SMITE</h4>
    <ul><li>${text}</li></ul>
  `, ""), "4.0", "en-us", emptyCatalog);
  const row = parsed.changes.find((change) => change.scope?.modeSlugs.includes("arurf")
    && change.entityKind === "system"
    && change.details.some((detail) => detail.text === text));

  assert.ok(row, "the Execute Smite detail should be retained under ARURF scope");
  assert.match(row.entityName, /execute smite/i);
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
});

test("parses Arena champion cameos as scoped champion changes", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([[
      "nasus",
      { slug: "nasus", name: "Nasus", aliases: ["Nasus"] },
    ]]),
  };
  const text = "Ascension: 200% size and increased Armor and Magic Resist; and the cooldown of your first ability is reduced to 1 second. If the ability stores charges, charge(s) will also be refunded. The buffs last 10 seconds.";
  const parsed = parsePatchArticle(articleHtml("5.0", "en-us", `
    <h2>ARENA CHANGES</h2><h3>CHAMPION CAMEOS</h3><h4>NASUS</h4>
    <p>Nasus makes random appearances on the battlefield, and taking him down grants Ascension.</p>
    <ul><li>${text}</li></ul>
  `, ""), "5.0", "en-us", catalog);
  const row = parsed.changes.find((change) => change.scope?.modeSlugs.includes("arena")
    && change.entityKind === "champion" && change.entitySlug === "nasus"
    && change.details.some((detail) => /200% size/u.test(detail.text))
    && change.details.some((detail) => /1 second/u.test(detail.text)));

  assert.ok(row, "the Nasus cameo detail should be retained under Arena scope");
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
});

test("preserves all 6.1e augment rows under the generic game-mode section", () => {
  const changes = parseChanges("6.1e", "en-us", `
    <h2>GAME MODE CHANGES</h2>
    <h3>AUGMENT CHANGES</h3><h4>Chapter Four</h4>
    <h5>Soul Siphon</h5><p>Healing increased.</p>
    <h4>Adventure Collection</h4><h5>Unbound</h5><p>Shield increased.</p>
  `);
  const rows = changes.filter((change) => change.entityKind === "augment");

  assert.deepEqual(rows.map(({ entityName }) => entityName), ["Soul Siphon", "Unbound"]);
  assert.ok(rows.every((row) => row.scope?.type === "game-mode"));
  assert.ok(rows.every((row) => row.sectionName === "GAME MODE CHANGES · AUGMENT CHANGES"));
  assert.ok(rows.every((row) => row.scope.modeSlugs.length === 0 && row.scope.modeNames.length === 0));
  assert.deepEqual(rows.map((row) => row.details.map(({ text }) => text)), [["Healing increased."], ["Shield increased."]]);
});

test("scopes an unknown mode name from the generic section without a closed mode list", () => {
  const unknown = parseChanges("9.0", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>Experimental Queue</h3>
    <h4>Augment Changes</h4><h5>Uncatalogued Augment</h5><p>Mode-specific detail.</p>
  `).find((change) => change.entityKind === "augment" && change.entityName === "Uncatalogued Augment");
  assert.ok(unknown);
  assert.deepEqual(unknown.scope.modeSlugs, ["experimental-queue"]);
});

test("keeps augment-pool prose as a scoped system change beside mode item changes", () => {
  const changes = parseChanges("9.9", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>Experimental Queue</h3>
    <h4>New Items</h4><h5>Uncatalogued Item</h5><p>Added to this mode.</p>
    <h4>Augment pool Adjustments</h4><p>We optimized the pool for this mode.</p>
  `);
  const item = changes.find(({ entityKind, entityName }) => entityKind === "item" && entityName === "Uncatalogued Item");
  const system = changes.find(({ entityKind, scope, details }) => entityKind === "system"
    && scope?.modeSlugs.includes("experimental-queue")
    && details.some(({ text }) => /optimized the pool/i.test(text)));

  assert.ok(item?.scope?.modeSlugs.includes("experimental-queue"));
  assert.ok(system?.scope?.modeSlugs.includes("experimental-queue"));
  assert.match(system.sectionName, /Augment pool Adjustments/);
  assert.deepEqual(system.details.map(({ text }) => text), ["We optimized the pool for this mode."]);
});

test("detects a newly introduced game mode under NEW from its description in both locales", () => {
  const scenarios = [
    {
      locale: "en-us",
      body: `<h2>NEW</h2><h3>Tag Duel</h3>
        <p>Tag Duel is here! This is a 1v1 mode where you defeat your opponent.</p>
        <ul><li>Pick three champions and swap between them.</li><li>All champions share one health bar.</li></ul>
        <h4>NEW CHAMPIONS</h4><p>A new champion joins the Rift.</p>`,
      name: "Tag Duel",
      slug: "tag-duel",
      details: ["Tag Duel is here! This is a 1v1 mode where you defeat your opponent.", "Pick three champions and swap between them.", "All champions share one health bar."],
    },
    {
      locale: "ru-ru",
      body: `<h2>НОВОЕ</h2><h3>Командная дуэль</h3>
        <p>Это вариация режима 1 на 1, где нужно победить противника.</p>
        <ul><li>Можно выбрать трех чемпионов.</li><li>У всех чемпионов общая шкала здоровья.</li></ul>`,
      name: "Командная дуэль",
      slug: "командная-дуэль",
      details: ["Это вариация режима 1 на 1, где нужно победить противника.", "Можно выбрать трех чемпионов.", "У всех чемпионов общая шкала здоровья."],
    },
  ];

  for (const scenario of scenarios) {
    const changes = parseChanges("4.3", scenario.locale, scenario.body);
    const mode = changes.find(({ entityKind, entityName, scope }) => entityKind === "system"
      && entityName === scenario.name && scope?.type === "game-mode");
    assert.ok(mode, `${scenario.locale}: expected a scoped row for ${scenario.name}`);
    assert.deepEqual(mode.scope.modeSlugs, [scenario.slug]);
    assert.deepEqual(mode.details.map(({ text }) => text), scenario.details);
    assert.equal(changes.some(({ entityKind, entityName, scope }) => entityKind === "system"
      && entityName === scenario.name && scope?.type !== "game-mode"), false,
    `${scenario.locale}: don't duplicate the mode as an unscoped system row`);
  }
});

test("parses 6.2j nested J-series augment groups without turning the group into an entity", () => {
  const changes = parseChanges("6.2j", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3>
    <h4>New Augments</h4><h5>J Series</h5>
    <h6>Incomparable</h6><p>Damage: 20 → 25.</p>
    <h6>Jubilation</h6><p>Cooldown: 10s → 8s.</p>
  `);
  const augments = changes.filter((change) => change.entityKind === "augment");

  assert.deepEqual(augments.map(({ entityName }) => entityName), ["Incomparable", "Jubilation"]);
  assert.ok(augments.every((change) => change.changeName === "new"));
  assert.ok(augments.every((change) => change.scope?.modeSlugs.includes("aaa-aram")));
  assert.equal(changes.some((change) => change.entityName === "J Series"), false);
});

test("parses Russian 6.2j AAA ARAM augmentations with mixed-script mode headings", () => {
  const changes = parseChanges("6.2j", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2>
    <h2>ААА ARAM</h2>
    <h3>Новые аугментации</h3>
    <h4>Серия J</h4>
    <h5>Несравненно</h5>
    <ul><li><p>Абсолютное умение можно применить дважды.</p></li></ul>
    <h5>Великие аугментации</h5>
    <ul><li><p>Ты получаешь прибавку к стойкости.</p></li></ul>
  `);
  const augments = changes.filter((change) => change.entityKind === "augment");

  assert.deepEqual(augments.map(({ entityName }) => entityName), ["Несравненно", "Великие аугментации"]);
  assert.ok(augments.every((change) => change.changeName === "new"));
  assert.ok(augments.every((change) => change.scope?.modeSlugs.includes("aaa-aram")));
  assert.deepEqual(augments.map((change) => change.details.map(({ text }) => text)), [
    ["Абсолютное умение можно применить дважды."],
    ["Ты получаешь прибавку к стойкости."],
  ]);
  assert.equal(changes.some((change) => change.entityName === "Серия J"), false);
});

test("recognizes a game mode printed as a br-separated paragraph prefix", () => {
  const changes = parseChanges("9.9", "ru-ru", `
    <h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2>
    <p>AAA ARAM<br><br>Успокаивающий слипстрим</p>
    <ul><li>Лечение: 1,5% → 1%</li></ul>
    <p>Твердость скалы</p><ul><li>Урон: 10 → 8</li></ul>
  `, emptyCatalog, "");
  const mode = changes.find(({ entityKind, scope }) => entityKind === "system" && scope?.type === "game-mode");

  assert.ok(mode);
  assert.equal(mode.entityName, "AAA ARAM");
  assert.deepEqual(mode.scope.modeSlugs, ["aaa-aram"]);
  assert.deepEqual(mode.details.filter(({ before, after }) => before && after).map(({ before, after }) => [before, after]), [
    ["1,5%", "1%"],
    ["10", "8"],
  ]);
  assert.equal(changes.some(({ entityName }) => entityName === "ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ"), false);
});

test("does not turn a section preface into a change entity when it introduces typed categories", () => {
  const changes = parseChanges("9.9", "en-us", `
    <h2>GAMEPLAY CHANGES</h2><p>Introductory explanation for the balance changes.</p>
    <h2>RUNE CHANGES</h2><h3>First Strike</h3><ul><li>Damage: 40 → 50</li></ul>
  `, emptyCatalog, "");

  assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "system" && entityName === "GAMEPLAY CHANGES"), false);
  assert.ok(changes.some(({ entityKind, entityName }) => entityKind === "rune" && /^first strike$/i.test(entityName)));
});

test("does not report a complete parse when a game-mode article yields no scoped records", () => {
  assert.throws(() => parsePatchArticle(articleHtml("6.1c", "en-us", "<h2>GAME MODE CHANGES</h2>"), "6.1c", "en-us", emptyCatalog),
    /game-mode changes but yielded no scoped change records/);
});

test("rejects a full article that yields no change rows before import", () => {
  const parsed = parsePatchArticle(articleHtml("6.1c", "en-us", "<h2>CHAMPION CHANGES</h2>"), "6.1c", "en-us", emptyCatalog);
  assert.throws(() => assertPatchArticleReadyForImport(parsed),
    /yielded no change records; refusing to mark an empty parse as complete/);
});

test("import validation catches numeric source deltas missing from parsed detail rows", () => {
  assert.throws(() => assertPatchArticleReadyForImport({
    changes: [{ details: [{ text: "Shield: 100 → 90" }] }],
    sections: [{ html: "<p>Cooldown: 10s → 8s</p>" }],
  }), /omitted 1 numeric source delta/);
  assert.doesNotThrow(() => assertPatchArticleReadyForImport({
    changes: [{ details: [{ text: "Cooldown: 10s → 8s" }, { text: "Shield: 100 → 90" }] }],
    sections: [{ html: "<p>Cooldown: 10s → 8s. Shield: 100 → 90</p>" }],
  }));
});

test("import validation catches standalone numeric change prose omitted from parsed details", () => {
  const statement = "Healing effectiveness: Against minions, the healing effectiveness for ranged champions is reduced to 30%.";
  const source = `<h3>RUNES</h3><h4>Fleet Footwork</h4><p>${statement}</p>`;

  assert.throws(() => assertPatchArticleReadyForImport({
    changes: [{ details: [] }],
    sections: [{ html: source }],
  }), /omitted 1 numeric prose change/);
  assert.doesNotThrow(() => assertPatchArticleReadyForImport({
    changes: [{ details: [{ text: statement }] }],
    sections: [{ html: source }],
  }));
});

test("does not treat numeric formula examples as omitted champion patch deltas", () => {
  const examples = [
    {
      locale: "en-us",
      text: "For example, when a champion levels from 1 to 2, bonus attack speed is 74% of attack speed growth. At max level, total bonus attack speed equals 1400% × attack speed growth.",
    },
    {
      locale: "ru-ru",
      text: "Например, когда чемпион повышает уровень с 1-го до 2-го, дополнительная скорость атаки составляет 74% от прироста. На максимальном уровне она равна 1400% × прирост скорости атаки.",
    },
  ];

  for (const { locale, text } of examples) {
    assert.doesNotThrow(() => assertPatchArticleReadyForImport({
      changes: [{ details: [] }],
      sections: [{ html: `<h2>${locale === "en-us" ? "CHAMPION CHANGES" : "ИЗМЕНЕНИЯ ЧЕМПИОНОВ"}</h2><h3>${locale === "en-us" ? "Attack speed growth" : "Прирост скорости атаки"}</h3><p>${text}</p>` }],
    }), locale);
  }
});

test("does not treat arrows in timing prose as numeric source deltas", () => {
  const timingExplanation = "Champions with Smite deal bonus 15% basic attack damage to monsters -> starting at 2:00, the bonus decays by 1% every 12 seconds.";
  assert.doesNotThrow(() => assertPatchArticleReadyForImport({
    changes: [{ details: [{ text: "Damage: 10 → 12" }] }],
    sections: [{ html: `<p>Damage: 10 → 12</p><p>${timingExplanation}</p>` }],
  }));
});

test("keeps every numeric delta when Riot separates system details with line breaks", () => {
  const parsed = parsePatchArticle(articleHtml("9.9", "ru-ru", `
    <h2>ИГРОВЫЕ СИСТЕМЫ</h2>
    <h3>Наказание за бездействие</h3>
    <p><em>Первое отсутствие: 30 минут → 10 минут</em><br>
      <em>Повторное отсутствие: 60 минут → 20 минут</em><br>
      <em>Последующие наказания: 12 часов → 6 часов</em></p>
  `, "SYSTEMS"), "9.9", "ru-ru", emptyCatalog);
  const row = parsed.changes.find(({ entityKind, entityName }) => (
    entityKind === "system" && entityName.toLocaleLowerCase("ru-ru").includes("наказание за бездействие")
  ));

  assert.ok(row);
  assert.equal(row.details.filter(({ before, after }) => before && after).length, 3);
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
});

test("preserves a numeric adjustment and cooldown from the same system paragraph", () => {
  const parsed = parsePatchArticle(articleHtml("9.9", "ru-ru", `
    <h2>ИГРОВЫЕ СИСТЕМЫ</h2>
    <h3>Изменения баланса душ драконов</h3>
    <h4>Душа ледяного дракона</h4>
    <p>Нанося вражескому чемпиону урон атакой или умением, вы помечаете его на 3 секунды. Когда метка пропадает, чемпион ненадолго замедляется на 50% и получает чистый урон в размере (12%→ 15%) от урона, нанесенного ему, пока он был помечен. Перезарядка: 15 → 12 секунд.</p>
  `, "SYSTEMS"), "9.9", "ru-ru", emptyCatalog);
  const row = parsed.changes.find(({ entityKind, entityName }) => (
    entityKind === "system" && entityName.toLocaleLowerCase("ru-ru").includes("душ драконов")
  ));

  assert.ok(row);
  assert.ok(row.details.some(({ before, after }) => before && after && /12%/.test(before) && /15%/.test(after)));
  assert.ok(row.details.some(({ text }) => /^Перезарядка: 15 → 12 секунд\.?$/.test(text)));
  assert.doesNotThrow(() => assertPatchArticleReadyForImport(parsed));
});

test("resets item parsing when a rich-text article switches to game systems", () => {
  const catalog = {
    ...emptyCatalog,
    items: new Map([["void staff", { slug: "void-staff", name: "Void Staff" }]]),
  };
  const changes = parseChanges("9.9", "en-us", `
    <h2>ITEMS</h2><h3>Void Staff</h3><ul><li>Magic Penetration: 40 → 45</li></ul>
    <h2>GAME SYSTEMS</h2><h3>AFK PENALTY</h3><p>First penalty: 30 min → 10 min</p>
  `, catalog);

  assert.ok(changes.some(({ entityKind, entitySlug }) => entityKind === "item" && entitySlug === "void-staff"));
  assert.ok(changes.some(({ entityKind, entityName, details }) => entityKind === "system"
    && entityName === "AFK PENALTY" && details.some(({ before, after }) => before && after)));
  assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "item" && entityName === "AFK PENALTY"), false);
});

test("keeps regular champion and item rows separate from same-entity game-mode changes", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([[
      "vex", { slug: "vex", name: "Векс", nameLocalizations: { en_us: "Vex", ru_ru: "Векс" }, aliases: ["Vex", "Векс"] },
    ]]),
    items: new Map([[
      "void staff", { slug: "void-staff", name: "Void Staff", nameLocalizations: { en_us: "Void Staff" } },
    ]]),
  };
  const changes = parseChanges("6.2j", "en-us", `
    <h2>CHAMPION CHANGES</h2><h3>Vex</h3><p>Damage: 100 → 95.</p>
    <h2>ITEM ADJUSTMENTS</h2><h3>Void Staff</h3><p>Magic Penetration: 40 → 45.</p>
    <h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3>
    <h4>Champion Changes</h4><h5>Vex</h5><p>Damage: 100 → 80.</p>
    <h4>Item Changes</h4><h5>Void Staff</h5><p>Magic Penetration: 40 → 30.</p>
  `, catalog);
  const rows = buildPatchChangeRows(changes, catalog, [], "6.2j");

  for (const [entityKind, entitySlug] of [["champion", "vex"], ["item", "void-staff"]]) {
    const matching = rows.filter((row) => row.entityKind === entityKind && row.entitySlug === entitySlug);
    assert.equal(matching.length, 2, `${entityKind}:${entitySlug} should produce core and scoped rows`);
    assert.equal(matching.filter((row) => row.scope?.type === "game-mode").length, 1);
    assert.equal(matching.filter((row) => !row.scope).length, 1);
  }
});

test("parses skin names and release captions across English and Russian article forms", () => {
  const catalog = {
    ...emptyCatalog,
    champions: new Map([
      ["karma", { slug: "karma", name: "Karma", nameLocalizations: { en_us: "Karma", ru_ru: "Карма" }, aliases: ["Karma", "Карма"] }],
      ["lee sin", { slug: "lee-sin", name: "Lee Sin", aliases: ["Lee Sin"] }],
      ["aatrox", { slug: "aatrox", name: "Aatrox", nameLocalizations: { ru_ru: "Атрокс" }, aliases: ["Aatrox", "Атрокс"] }],
      ["xayah", { slug: "xayah", name: "Xayah", nameLocalizations: { ru_ru: "Шая" }, aliases: ["Xayah", "Шая"] }],
      ["rakan", { slug: "rakan", name: "Rakan", nameLocalizations: { ru_ru: "Рэйкан" }, aliases: ["Rakan", "Рэйкан"] }],
    ]),
  };

  const englishPassSkins = parseChanges("3.3", "en-us", `
    <h2>NEW WILD PASS</h2>
    <p>Here straight from the cosmos to brighten your gameplay and this Wild Pass is Stargazer Karma. She'll be your reward for completing this pass.</p>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");
  assert.equal(englishPassSkins.length, 1);
  assert.equal(englishPassSkins[0].entityName, "Stargazer Karma");

  const russianPassSkins = parseChanges("3.3", "ru-ru", `
    <h2>НОВЫЙ ПРОПУСК WILD RIFT</h2>
    <p>На 50-м уровне нового пропуска Wild Rift вы встретите Звездочета Карму. Помимо этого образа, вас ждет множество других наград.</p>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");
  assert.equal(russianPassSkins.length, 1);
  assert.equal(russianPassSkins[0].sourceChampionSlug, "karma");
  assert.equal(russianPassSkins[0].entityName, "Звездочета Карму");

  const englishGodFistSkins = parseChanges("3.3", "en-us", `
    <h2>SKINS</h2><table><tbody><tr><td>
      <img src="https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/god-fist-lee-sin.jpg">
      <p>God Fist Lee Sin Actually releasing in 3.3a</p>
    </td></tr></tbody></table>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");
  assert.equal(englishGodFistSkins.length, 1);
  assert.equal(englishGodFistSkins[0].entityName, "God Fist Lee Sin");
  assert.equal(englishGodFistSkins[0].details[0].text, "Actually releasing in 3.3a");

  const russianPatchRelease = parseChanges("4.3d", "ru-ru", `
    <h2>ОБЛИКИ</h2><table><tbody><tr><td>
      <img src="https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/armored-aatrox.jpg">
      <p>Бронированный Атрокс</p>
      <p>Появится в патче 8.1a</p>
    </td></tr></tbody></table>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");
  assert.equal(russianPatchRelease.length, 1);
  assert.equal(russianPatchRelease[0].entityName, "Бронированный Атрокс");
  assert.equal(russianPatchRelease[0].details[0].text, "Появится в патче 8.1a");

  const russianPairSkins = parseChanges("3.3", "ru-ru", `
    <h2>ОБЛИКИ</h2><table><tbody><tr><td>
      <img src="https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/star-guardian-xayah-rakan.jpg">
      <p>Звездные защитники Шая и Рэйкан</p>
      <p>Появятся в игре 15 июля в 03:01 по московскому времени.</p>
    </td></tr></tbody></table>
  `, catalog).filter(({ entityKind }) => entityKind === "skin");
  assert.equal(russianPairSkins.length, 2);
  assert.deepEqual(russianPairSkins.map(({ sourceChampionSlug, entityName }) => [sourceChampionSlug, entityName]), [
    ["xayah", "Звездные защитники Шая и Рэйкан"],
    ["rakan", "Звездные защитники Шая и Рэйкан"],
  ]);
  assert.ok(russianPairSkins.every((change) => change.details[0].text === "Появятся в игре 15 июля в 03:01 по московскому времени"));
});

test("does not classify a detached parenthetical skin aside as a champion skin", () => {
  const janna = {
    slug: "janna",
    name: "Janna",
    nameLocalizations: { "ru-ru": "Жанна" },
    aliases: ["Janna", "Жанна"],
  };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["janna", janna], ["жанна", janna]]),
  };
  const changes = parseChanges("4.3d", "ru-ru", `
    <p>А пока мы следуем за ветром перемен, перерабатывая Жанну и внося правки баланса для других чемпионов (про новые образы тоже не забыли). Встречайте обновление 4.3d!</p>
  `, catalog);

  assert.equal(changes.some(({ entityKind, entitySlug }) => entityKind === "skin" && entitySlug === "janna"), false);
  assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "skin" && /перерабатывая Жанну/i.test(entityName)), false);
});

test("does not infer skin releases from future availability or a champion rework", () => {
  const yuumi = { slug: "yuumi", name: "Yuumi", aliases: ["Yuumi"] };
  const janna = { slug: "janna", name: "Janna", aliases: ["Janna"] };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["yuumi", yuumi], ["janna", janna]]),
  };

  // Riot 4.3 EN: https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-4-3/
  const futureWildPassSkin = parseChanges("4.3", "en-us", `
    <p>As a reminder this will be our first Wild Pass of Patch 4.3, so Food Spirits Yuumi will be available later on!</p>
  `, catalog);
  assert.deepEqual(futureWildPassSkin.filter(({ entityKind }) => entityKind === "skin").map(({ entityName }) => entityName), []);

  // Riot 4.3d EN: https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-4-3d/
  const reworkAnnouncement = parseChanges("4.3d", "en-us", `
    <p>Before we close out 4.3, we wanted to blow you all away, so Janna’s rework will be launching this patch, along with seemingly some balance updates, and some new skins. Welcome to Patch 4.3d!</p>
  `, catalog);
  assert.deepEqual(reworkAnnouncement.filter(({ entityKind }) => entityKind === "skin").map(({ entityName }) => entityName), []);
});

test("reparsing a full skin-section article ignores a champion rework aside and keeps listed skins", () => {
  const champions = [
    { slug: "janna", name: "Janna", aliases: ["Janna"] },
    { slug: "pyke", name: "Pyke", aliases: ["Pyke"] },
    { slug: "jax", name: "Jax", aliases: ["Jax"] },
  ];
  const catalog = {
    ...emptyCatalog,
    champions: new Map(champions.flatMap((champion) => [
      [champion.slug, champion],
      ...champion.aliases.map((alias) => [alias.toLocaleLowerCase(), champion]),
    ])),
  };
  const body = `
    <p>Before we close out 4.3, we wanted to blow you all away, so Janna’s rework will be launching this patch, along with seemingly some balance updates, and some new skins. Welcome to Patch 4.3d!</p>
    <p><em>Reminder: content will be released throughout the patch.</em></p>
    <h2>SKINS</h2>
    <table><tbody>
      <tr><td><img src="https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/pyke.jpg"><p>Ashen Knight Pyke</p><p>Releasing October 12 @ 00:01 UTC</p></td></tr>
      <tr><td><img src="https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/jax.jpg"><p>Stargazer Jax</p><p>Releasing October 23 @ 00:01 UTC</p></td></tr>
    </tbody></table>
  `;

  const parsed = parsePatchArticle(articleHtml("4.3d", "en-us", body), "4.3d", "en-us", catalog);
  const skinRows = buildPatchChangeRows(parsed.changes, catalog, [], "4.3d")
    .filter(({ entityKind }) => entityKind === "skin")
    .map(({ entityName, entitySlug }) => ({ entityName, entitySlug }));

  assert.deepEqual(skinRows, [
    { entityName: "Ashen Knight Pyke", entitySlug: "pyke-ashen-knight-pyke" },
    { entityName: "Stargazer Jax", entitySlug: "jax-stargazer-jax" },
  ]);
});

test("does not infer skins from unrelated historical champion, VGU, event, or chroma prose", () => {
  const champions = [
    { slug: "soraka", name: "Soraka", aliases: ["Soraka"] },
    { slug: "dr-mundo", name: "Dr. Mundo", aliases: ["Dr. Mundo", "Mundo"] },
    { slug: "zed", name: "Zed", aliases: ["Zed"] },
    { slug: "rengar", name: "Rengar", aliases: ["Rengar"] },
    { slug: "aurora", name: "Aurora", nameLocalizations: { ru_ru: "Аврора" }, aliases: ["Aurora", "Аврора"] },
  ];
  const catalog = {
    ...emptyCatalog,
    champions: new Map(champions.flatMap((champion) => champion.aliases.map((alias) => [alias.toLocaleLowerCase(), champion]))),
  };
  const cases = [
    ["3.2c", "en-us", "We are nerfing some of Soraka’s healing power before the release of Patch 3.3."],
    ["2.6", "en-us", "Dr. Mundo’s VGU will be released this patch. All previous owners will keep him and his skin upgrades."],
    ["2.4d", "en-us", "This final balance patch cycle addresses Zed’s dominance before the release of Patch 2.5."],
    ["2.2b", "en-us", "Rengar will be released if his team wins during the event."],
    ["6.2", "ru-ru", "В событии можно получить эксклюзивные цветовые схемы для Авроры."],
  ];

  for (const [version, locale, paragraph] of cases) {
    const changes = parseChanges(version, locale, `<p>${paragraph}</p>`, catalog);
    assert.deepEqual(changes.filter(({ entityKind }) => entityKind === "skin"), [], `${version} ${locale}: ${paragraph}`);
  }

  const staleSkinSection = parseChanges("2.2b", "en-us", `
    <h2>SKINS</h2>
    <p>God-King skins will be available for Darius and Garen in the store.</p>
    <p>** Released if Rengar’s team wins during the event.</p>
  `, catalog);
  assert.equal(staleSkinSection.some(({ entityKind, sourceChampionSlug }) => entityKind === "skin" && sourceChampionSlug === "rengar"), false,
    "an earlier skin section must not turn an accessory release condition into a skin");

  const realSkin = parseChanges("2.6", "en-us", "<p>New skins: Soraka’s Reaper Soraka skin arrives this patch.</p>", catalog);
  assert.ok(realSkin.some(({ entityKind, sourceChampionSlug }) => entityKind === "skin" && sourceChampionSlug === "soraka"),
    "nearby explicit skin cues must still preserve real skin announcements");
});

test("uses Riot 2.0 article context to exclude free rotation and social-sharing copy", () => {
  // Source: https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-2-0/
  const rotationChampions = [
    ["braum", "Braum"], ["akali", "Akali"], ["camille", "Camille"], ["alistar", "Alistar"],
    ["fizz", "Fizz"], ["dr-mundo", "Dr. Mundo"], ["graves", "Graves"], ["draven", "Draven"],
    ["jhin", "Jhin"], ["jarvan-iv", "Jarvan IV"], ["malphite", "Malphite"],
    ["miss-fortune", "Miss Fortune"], ["orianna", "Orianna"], ["soraka", "Soraka"],
    ["shyvana", "Shyvana"], ["tryndamere", "Tryndamere"], ["sona", "Sona"],
    ["xin-zhao", "Xin Zhao"], ["varus", "Varus"], ["zed", "Zed"], ["amumu", "Amumu"],
  ];
  const catalog = {
    ...emptyCatalog,
    champions: new Map(rotationChampions.map(([slug, name]) => [
      name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      { slug, name, aliases: [name] },
    ])),
  };

  const changes = parseChanges("2.0", "en-us", riot20ParserExcerpts, catalog, "");
  const rotationRows = changes.filter(({ sectionName }) => sectionName === "FREE-TO-PLAY CHAMPION ROTATION");
  assert.deepEqual(rotationRows, []);
  for (const [slug] of rotationChampions) {
    assert.equal(rotationRows.some(({ entitySlug }) => entitySlug === slug), false, `rotation must not create ${slug}`);
  }

  const zedBalance = changes.find(({ entityKind, entitySlug, details }) => entityKind === "champion"
    && entitySlug === "zed" && details.some(({ text }) => text.includes("Missile Width: 175 → 125")));
  assert.ok(zedBalance, "the real Zed balance adjustment must remain");
  assert.equal(changes.some(({ entityKind, entityName }) => entityKind === "skin"
    && entityName === "Perfect for flexing after a 15/0 Zed"), false);
  assert.ok(changes.some(({ entityKind, sourceChampionSlug, entityName }) => entityKind === "skin"
    && sourceChampionSlug === "amumu" && entityName === "Sad Robot Amumu"), "the real SKINS list entry must remain");
});

test("extracts a named skin from an appositive after a skin-line description", () => {
  const tryndamere = {
    slug: "tryndamere",
    name: "Tryndamere",
    nameLocalizations: { "ru-ru": "Триндамир" },
    aliases: ["Tryndamere", "Триндамир"],
  };
  const catalog = {
    ...emptyCatalog,
    champions: new Map([["tryndamere", tryndamere], ["триндамир", tryndamere]]),
  };

  const russianChanges = parseChanges("2.0", "ru-ru", riot20RussianRankReward, catalog);
  const russianSkins = russianChanges.filter((change) => change.entityKind === "skin");
  assert.equal(russianSkins.length, 1);
  assert.equal(russianSkins[0].entityName, "Блистательный Триндамир");
  assert.equal(russianSkins[0].sourceChampionSlug, "tryndamere");
  assert.equal(russianSkins[0].entityName.includes("получат первый образ"), false);

  const englishChanges = parseChanges("9.0", "en-us", `
    <p>Players who reach Gold receive their first skin from the Glorious skin line — Glorious Tryndamere.</p>
  `, catalog);
  assert.ok(englishChanges.some((change) => change.entityKind === "skin"
    && change.entityName === "Glorious Tryndamere"
    && change.sourceChampionSlug === "tryndamere"));
});

test("keeps nested Riot rune headings separate when the current catalog lacks those runes", () => {
  const changes = parsePatchArticle(riot73bArticle, "7.3b", "en-us", emptyCatalog).changes;
  const runes = changes.filter((change) => change.entityKind === "rune");

  assert.deepEqual(runes.map(({ entityName }) => entityName), [
    "Electrocute",
    "Cheap Shot",
    "Grasp of the Undying",
    "Aery",
  ]);
  assert.equal(runes[0].details.length, 1);
  assert.equal(runes[1].details.length, 1);
  assert.equal(runes[2].details.length, 3);
  assert.equal(runes[3].details.length, 2);
  assert.ok(runes.every(({ details }) => details.every(({ component }) => !component)));
});


test("does not infer skins from cosmetic substrings inside unrelated words", () => {
  const catalog = { ...emptyCatalog, champions: new Map([
    ["yasuo", { slug: "yasuo", name: "Yasuo", nameLocalizations: { ru_ru: "Ясуо" }, aliases: ["Yasuo", "Ясуо"] }],
    ["lucian", { slug: "lucian", name: "Lucian", nameLocalizations: { ru_ru: "Люциан" }, aliases: ["Lucian", "Люциан"] }],
  ]) };
  for (const [locale, text] of [
    ["ru-ru", "Изменения дадут противникам больше свободы, а Ясуо и Люциан станут сильнее. Мы изменили предметы для магов, чтобы у игроков было больше разнообразия."],
    ["en-us", "Players are asking Yasuo about his lane changes."],
  ]) {
    const changes = parseChanges("8.2", locale, `<p>${text}</p>`, catalog);
    assert.deepEqual(changes.filter((change) => change.entityKind === "skin"), [], locale);
  }
  const realSkin = parseChanges("8.2", "ru-ru", "<p>Новый облик: Космический Ясуо появится в игре.</p>", catalog);
  assert.equal(realSkin.filter((change) => change.entityKind === "skin").length, 1);
});

test("separates skin titles from release captions across br and paragraph boundaries", () => {
  for (const name of ["Mecha Aatrox Exquisite Edition", "Elderwood Xayah"]) {
    for (const separator of ["<br>", "</p><p>"]) {
      const changes = parseChanges("8.2", "en-us", `<h2>SKINS</h2><table><tr><td>
        <p><img src="https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/example-skin.jpg"></p>
        <p>${name}${separator}Releasing June 05 @ 00:01 UTC</p>
      </td></tr></table>`, skinChampionCatalog).filter((change) => change.entityKind === "skin");
      assert.equal(changes.length, 1);
      assert.equal(changes[0].entityName, name);
      assert.ok(!changes[0].entitySlug.includes("releasing"));
      assert.equal(changes[0].details[0].text, "Releasing June 05 @ 00:01 UTC");
    }
  }
});


test("maps prefixed mode items to distinct catalog variant identities across locales", () => {
  const items = [
    { slug: "infinity-orb", name: "Infinity Orb", aliases: ["Сфера бесконечности"] },
    { slug: "seryldas-grudge", name: "Serylda's Grudge", aliases: ["Злоба Серильды"] },
  ];
  const catalog = {
    ...emptyCatalog,
    items: new Map(items.flatMap((item) => [
      [item.name.toLowerCase().replace(/[’']/g, " "), item],
      ...item.aliases.map((alias) => [alias.toLowerCase().replace(/[’']/g, " "), item]),
    ])),
  };
  const inputs = [
    ["en-us", `
      <h2>GAMEPLAY CHANGES</h2><h3>ITEMS</h3>
      <h4>Yordle Infinity Orb</h4><p>Damage is too high.</p><h5>Thunderfall</h5><ul><li>Damage: 50 → 40</li></ul>
      <h4>Yordle Serylda's Grudge</h4><p>Ability damage is too high.</p><h5>Frostbite</h5><ul><li>Damage: 25 → 10</li></ul>
    `],
    ["ru-ru", `
      <h2>ИЗМЕНЕНИЯ ИГРОВОГО ПРОЦЕССА</h2><h3>ПРЕДМЕТЫ</h3>
      <h4>Йордловская Сфера бесконечности</h4><p>Урон слишком высок.</p><h5>Раскаты грома</h5><ul><li>Урон: 50 → 40</li></ul>
      <h4>Йордловская Злоба Серильды</h4><p>Урон слишком высок.</p><h5>Обморожение</h5><ul><li>Урон: 25 → 10</li></ul>
    `],
  ];

  for (const [locale, body] of inputs) {
    const parsed = parseChanges("9.0", locale, body, catalog);
    const rows = buildPatchChangeRows(parsed, catalog, [], "9.0").filter(({ entityKind }) => entityKind === "item");
    assert.deepEqual(rows.map(({ entitySlug }) => entitySlug).sort(), ["variant-yordle-infinity-orb", "variant-yordle-seryldas-grudge"]);
  }
});

test("does not recover emoji-only Arena minion rows as global changes", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>Arena</h3>
    <h4>Melee Minion</h4><p>🔪🐶🛡️</p>
  `);

  assert.equal(changes.some((change) => change.entityKind === "system" && change.entityName === "Melee Minion" && change.scope?.type !== "game-mode"), false);
  assert.ok(changes.filter((change) => change.entityName === "Melee Minion").every((change) => change.scope?.modeSlugs.includes("arena")));
});
