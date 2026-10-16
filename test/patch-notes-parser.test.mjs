import assert from "node:assert/strict";
import test from "node:test";

import { parsePatchArticle } from "../lib/patchNotesParser.mjs";

const emptyCatalog = {
  champions: new Map(),
  items: new Map(),
  runes: new Map(),
  spells: new Map(),
};

function articleHtml(version, locale, body) {
  const page = {
    url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-7-1h/`,
    blades: [
      { type: "articleMasthead", title: `Wild Rift Patch Notes ${version}` },
      { type: "articleRichText", fragmentId: "ITEM ADJUSTMENTS", richText: { body } },
    ],
  };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { page } },
  })}</script>`;
}

function parseChanges(version, locale, body, catalog = emptyCatalog) {
  return parsePatchArticle(articleHtml(version, locale, body), version, locale, catalog).changes;
}

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
    ["en-us", "<h4>Skarner</h4><p><i>Base Stats</i></p><ul><li>Base Health: 690 → 660</li><li>Health per Level: 128 → 132</li></ul>"],
    ["ru-ru", "<h4>Скарнер</h4><p><i>Основные показатели</i></p><ul><li>Базовый запас здоровья: 690 → 660</li><li>Прирост здоровья: 128 → 132</li></ul>"],
  ];
  for (const [locale, body] of inputs) {
    const skarner = parseChanges("7.3", locale, body).find((change) => change.entityKind === "champion" && change.entitySlug === "skarner");
    assert.ok(skarner);
    assert.deepEqual(skarner.details.map(({ before, after }) => [before, after]), [["690", "660"], ["128", "132"]]);
  }
});

test("classifies Dusk and Dawn as a nerf in both patch 7.3 locales", () => {
  const inputs = [
    ["en-us", "<h4>Dusk and Dawn</h4><p>Base Stats</p><ul><li>Ability Power: 70 → 60</li></ul>"],
    ["ru-ru", "<h4>Рассвет и закат</h4><p>Основные параметры</p><ul><li>Сила умений: 70 → 60</li></ul>"],
  ];
  for (const [locale, body] of inputs) {
    const item = parseChanges("7.3", locale, body).find((change) => change.entityKind === "item" && change.entitySlug === "dusk-and-dawn");
    assert.equal(item?.changeName, "nerf");
  }
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

test("adds localized 7.2 RU item rows and keeps the August mini-pass variant unreleased", () => {
  const body = [
    "<p><strong>Изменения предметов</strong></p><p>Посох Бездны</p><ul><li>Теперь предмет соответствует версии из ранговых матчей.</li></ul>",
    "<h4><strong>Завеса банши</strong></h4><p>Обновленный защитный предмет.</p><p>Основные параметры</p><ul><li>Стоимость: 3000</li></ul>",
    "<p>Космическое жало Скарнер появится в игре 9 июля.</p><p>Мини-пропуск Wild Rift \"Космическое жало Скарнер\"</p><ul><li>27 августа выйдет мини-пропуск, где вас будет ждать Космическое жало Скарнер.</li></ul>",
  ].join("");
  const changes = parseChanges("7.2", "ru-ru", body);
  const voidStaff = changes.find((change) => change.entityKind === "item" && change.entitySlug === "void-staff");
  const banshee = changes.find((change) => change.entityKind === "item" && change.entitySlug === "banshees-veil");
  const variant = changes.find((change) => change.entityKind === "skin" && change.entitySlug === "skarner-scorpio-deity-ancient-wisdom-skarner");
  assert.equal(voidStaff?.entityName, "Посох Бездны");
  assert.equal(voidStaff?.changeName, "adjustment");
  assert.equal(banshee?.entityName, "Завеса банши");
  assert.equal(banshee?.changeName, "rework");
  assert.equal(variant?.entityName, "Космическое жало Скарнер (Древняя мудрость)");
  assert.equal(variant?.changeName, null);
});

test("fills the 7.2 localized skin release and return rows from the official article text", () => {
  const inputs = [
    ["en-us", `
      <p>Season-exclusive skin Glorious Eminence Renekton will be released July 10.</p>
      <h2>NEW WILD PASS</h2><p>Movie Director Wild Pass starring Movie Director Ryze and Ascended Movie Director Ryze.</p>
      <h3>Returning Wild Pass skins</h3><ul><li>Dream Raider Kha'Zix</li><li>Ascended Dream Raider Kha'Zix</li><li>Superhero Jayce</li><li>Ascended Superhero Jayce</li></ul>
      <h3>Returning Mini Wild Pass skins</h3><ul><li>Elderwood Xayah</li><li>Elderwood Xayah (Indigo)</li><li>Elderwood Rakan</li><li>Elderwood Rakan (Turquoise)</li></ul>
      <p>Unlock three Cyber Pop Zoe chromas.</p><p>New Mini Wild Pass Return Track featuring Battlecast Nasus.</p>
      <p>Unlock the all-new Purple Garlic Lulu skin.</p>
    `, [
      ["renekton-glorious-eminence-renekton", "new"],
      ["ryze-movie-director-ryze", "new"], ["ryze-ascended-movie-director-ryze", "new"],
      ["khazix-dream-raider-khazix", "returning"], ["khazix-ascended-dream-raider-khazix", "returning"],
      ["jayce-superhero-jayce", "returning"], ["jayce-ascended-superhero-jayce", "returning"],
      ["xayah-elderwood-xayah", "returning"], ["xayah-elderwood-xayah-indigo", "returning"],
      ["rakan-elderwood-rakan", "returning"], ["rakan-elderwood-rakan-turquoise", "returning"],
      ["zoe-cyber-pop-zoe-chromas", "available"], ["nasus-battlecast-nasus", null], ["lulu-purple-garlic-lulu", "new"],
    ]],
    ["ru-ru", `
      <p>Эксклюзивный образ «Блистательная знаменитость Ренектон» появится в игре 10 июля.</p>
      <h2>НОВЫЙ ПРОПУСК WILD RIFT</h2><p>Режиссер Райз и Вознесшийся режиссер Райз.</p>
      <h3>Повторные образы пропуска Wild Rift</h3><ul><li>Похититель снов Ка'Зикс</li><li>Вознесшийся Похититель снов Ка'Зикс</li><li>Супергерой Джейс</li><li>Вознесшийся супергерой Джейс</li></ul>
      <h3>Повторные образы мини-пропуска Wild Rift</h3><ul><li>Дух леса Шая</li><li>Дух леса Шая (темно-синий)</li><li>Дух леса Рэйкан</li><li>Дух леса Рэйкан (бирюзовый)</li></ul>
      <p>Цветовые схемы Киберпоп-Зои.</p><p>Повторный мини-пропуск с Модифицированным Насусом.</p>
      <p>Новый образ «Фиолетовый чеснок Лулу».</p>
    `, [
      ["renekton-glorious-eminence-renekton", "new"],
      ["ryze-movie-director-ryze", "new"], ["ryze-ascended-movie-director-ryze", "new"],
      ["khazix-dream-raider-khazix", "returning"], ["khazix-ascended-dream-raider-khazix", "returning"],
      ["jayce-superhero-jayce", "returning"], ["jayce-ascended-superhero-jayce", "returning"],
      ["xayah-elderwood-xayah", "returning"], ["xayah-elderwood-xayah-indigo", "returning"],
      ["rakan-elderwood-rakan", "returning"], ["rakan-elderwood-rakan-turquoise", "returning"],
      ["zoe-cyber-pop-zoe-chromas", "available"], ["nasus-battlecast-nasus", null], ["lulu-purple-garlic-lulu", "new"],
    ]],
  ];

  for (const [locale, body, expected] of inputs) {
    const changes = parseChanges("7.2", locale, body);
    for (const [slug, status] of expected) {
      const matches = changes.filter((change) => change.entityKind === "skin" && change.entitySlug === slug);
      assert.equal(matches.length, 1, `${locale} should emit one row for ${slug}`);
      assert.equal(matches[0].changeName, status, `${locale} status for ${slug}`);
    }
  }
});

test("keeps all seven 7.2 tier-three boot upgrades and classifies Mercury's Treads as adjusted", () => {
  const bootSlugs = [
    "spellslingers-shoes", "chainlaced-crushers", "gunmetal-greaves", "armored-advance",
    "immortal-treads", "armorcrusher-boots", "crimson-lucidity",
  ];
  for (const locale of ["en-us", "ru-ru"]) {
    const changes = parseChanges("7.2", locale, "<h2>BOOTS ADJUSTMENTS</h2><p>Tier 3 boots.</p>");
    for (const slug of bootSlugs) {
      const row = changes.find((change) => change.entityKind === "item" && change.entitySlug === slug);
      assert.ok(row, `${locale} should include ${slug}`);
      assert.equal(row.changeName, "new");
    }
  }

  const catalog = {
    ...emptyCatalog,
    items: new Map([["mercury s treads", { slug: "mercurys-treads", name: "Mercury's Treads" }]]),
  };
  const mercury = parseChanges("7.2", "en-us", `
    <h2>BOOTS ADJUSTMENTS</h2><h4>Mercury's Treads</h4><p>Base Stats</p>
    <ul><li>Price: 900 → 1200</li><li>Tenacity: 0 → 15%</li></ul>
  `, catalog).find((change) => change.entityKind === "item" && change.entitySlug === "mercurys-treads");
  assert.equal(mercury?.changeName, "adjustment");
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

test("filters the 7.1a mode-only augment fix from general system rows", () => {
  const changes = parseChanges("7.1a", "en-us", `
    <h2>BUG FIXES</h2><ul><li>Fixed an issue where augments could be switched in AAA ARAM champion select.</li></ul>
    <h2>GAME MODE CHANGES</h2><h3>AAA ARAM</h3><p>Mode changes.</p>
  `);
  assert.equal(changes.some((change) => change.entityKind === "system"), false);
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
    for (const name of names) {
      const row = changes.find((change) => change.entityKind === "system" && change.entityName === name);
      assert.ok(row, `${locale} should include ${name}`);
      assert.equal(row.details.length, 1);
      assert.match(row.details[0].text, /kill|убийств|aggro|агрессия/i);
    }
  }
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

test("keeps the 7.1g Red Brambleback burn level scaling in English", () => {
  const changes = parseChanges("7.1g", "en-us", `
    <h2>JUNGLE CHANGES</h2><h3>Red Brambleback</h3>
    <p>Burn damage to champions: 6–34 → 5–15 at all levels.</p>
    <p>Burn damage to non-champions: 3–17 → 5–15 at all levels.</p>
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
  for (const locale of ["en-us", "ru-ru"]) {
    const champion = parsePatchArticle(characterPage("7.1g", locale), "7.1g", locale, catalog).changes
      .find((change) => change.entityKind === "champion");
    assert.equal(champion.sectionName, locale === "ru-ru" ? "ИЗМЕНЕНИЯ ЧЕМПИОНОВ" : "Champions");
  }

  const patch71hTaliyah = parseChanges("7.1h", "en-us", `
    <h2>CHAMPION CHANGES</h2><h3>Taliyah</h3>
    <h4>nerf</h4><ul><li>Movement Speed: 355 → 350</li></ul>
    <h4>nerf</h4><ul><li>Movement Speed: 10%/15%/25%/40% → 5%/10%/20%/35%</li></ul>
    <h4>nerf</h4><ul><li>Cooldown reduction on Worked Ground: 50% → 30%</li></ul>
  `, catalog).find((change) => change.entityKind === "champion" && /taliyah/i.test(change.entityName));
  assert.equal(patch71hTaliyah.changeName, "Base Stats");
  assert.deepEqual(patch71hTaliyah.details.map(({ component }) => component), ["Base Stats", "Rock Surfing", "Threaded Volley"]);

  const patch71fKsante = parseChanges("7.1f", "en-us", `
    <h2>CHAMPION CHANGES</h2><h3>K'Sante</h3><h4>nerf</h4>
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
