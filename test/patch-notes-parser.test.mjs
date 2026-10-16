import assert from "node:assert/strict";
import test from "node:test";

import { parsePatchArticle, parsePatchIndex } from "../lib/patchNotesParser.mjs";
import { buildPatchChangeRows } from "../lib/patchNotesChangeRecords.mjs";

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
    url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-7-1h/`,
    blades: [
      { type: "articleMasthead", title: `Wild Rift Patch Notes ${version}` },
      { type: "articleRichText", fragmentId, richText: { body } },
    ],
  };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page } },
  })}</script>`;
}

function parseChanges(version, locale, body, catalog = emptyCatalog, fragmentId) {
  return parsePatchArticle(articleHtml(version, locale, body, fragmentId), version, locale, catalog).changes;
}

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
    ["ru-ru", `<h2>НОВЫЙ ЧЕМПИОН</h2><h3>НОРРА, ПОВЕЛИТЕЛЬНИЦА ПОРТАЛОВ</h3><p>Норра появится в игре 4 февраля в 03:01.</p>
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

    assert.equal(changes.length, 1, `${locale}: ${changes.map(({ entityKind, entityName }) => `${entityKind}:${entityName}`).join(", ")}`);
    assert.equal(changes[0].entityKind, "champion");
    assert.equal(changes[0].entitySlug, "norra");
    assert.equal(changes[0].entityName, locale === "en-us" ? "Norra" : "Норра");
    assert.equal(changes[0].changeName, "new");
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
  `);

  assert.equal(changes.some((entry) => entry.entityName === "Jungle"), false);
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
  assert.equal(item.changeName, "adjustment");
  assert.equal(item.details.some(({ text }) => text === "Damage: 20 → 25"), true);
  assert.equal(changes.some((change) => change.entityName === "Uncatalogued Component"), false);
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
      <h2>ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ</h2><p>AAA ARAM</p>
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
    assert.equal(changes.some((change) => /AAA ARAM/i.test(change.entityName || "")), false);
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

test("maps prefixed item variants to catalog identities in old and new patch prose", () => {
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
    assert.deepEqual(rows.map(({ entitySlug }) => entitySlug).sort(), ["infinity-orb", "seryldas-grudge"]);
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

  assert.equal(changes.some((change) => /Poppy|Rite of Ruin|Guinsoo/i.test(change.entityName)), false);
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
  assert.equal(systemRows.length, 1);
  assert.deepEqual(systemRows[0].details.map(({ text }) => text), [
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
      const row = changes.find((change) => change.entityKind === "system" && change.entityName === name);
      assert.ok(row, `${locale} should include ${name}`);
      assert.ok(futureChanges.some((change) => change.entityKind === "system" && change.entityName === name), `${locale}: future parser missed ${name}`);
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
    assert.equal(minionRows.length, 5);
    assert.equal(changes.some((change) => /AAA ARAM/i.test(change.entityName || "")), false);
    assert.ok(minionRows.every((change) => change.sectionName === (locale === "ru-ru"
      ? "Изменения игрового процесса"
      : "GAMEPLAY CHANGES")));
    assert.deepEqual(minionRows.map((change) => change.details.map((detail) => detail.text)), locale === "ru-ru"
      ? [["🔪🐶🛡️"], ["🐶🪄"], ["🚀🐶", "🛡️"], ["🚗🐶", "🔪🛡️🔪"], ["🛡️💪🐶🗡️"]]
      : [["🔪🐶🛡️"], ["🐶🪄"], ["🚀🐶", "🛡️"], ["🚗🐶", "🔪🛡️🔪"], ["🛡️💪🐶🗡️"]]);
    assert.equal(parseChanges("9.0", locale, body).filter((change) => names.includes(change.entityName)).length, 5);
  }
});

test("does not recover emoji-only minion rows from an Arena subsection", () => {
  const changes = parseChanges("9.0", "en-us", `
    <h2>GAME MODE CHANGES</h2><h3>Arena</h3>
    <h4>Melee Minion</h4><p>🔪🐶🛡️</p>
  `);

  assert.equal(changes.some((change) => change.entityKind === "system" && change.entityName === "Melee Minion"), false);
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
    const systemRows = changes.filter((change) => change.entityKind === "system");

    assert.equal(systemRows.length, 7, `${locale}: ${systemRows.map(({ entityName }) => entityName).join(" | ")}`);
    assert.equal(changes.some((change) => /AAA ARAM|Mode-only/i.test(change.entityName || "")), false);
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
    const rows = changes.filter((change) => change.entityKind === "system");
    assert.equal(rows.length, 1);
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
