import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChampionLoreRecord,
  extractGenerationFacts,
  selectUniverseLoreContent,
  selectWildRiftNewsLoreContent,
} from "../lib/championLoreImport.mjs";

test("selectUniverseLoreContent extracts the champion summary after the official title", () => {
  const result = selectUniverseLoreContent({
    championName: "Ари",
    headings: ["ДЕВЯТИХВОСТАЯ ЛИСА"],
    paragraphs: [
      "Короткая цитата Ари.",
      "Ари – загадочная вастайи-лиса, которая с рождения ощущает связь с магией мира духов. Она манипулирует эмоциями жертвы и теперь создаёт собственные воспоминания вместо чужих.",
      "Описание другого материала на странице, которое не должно попасть в биографию чемпиона.",
    ],
  });

  assert.equal(result.title, "ДЕВЯТИХВОСТАЯ ЛИСА");
  assert.match(result.officialLore, /^Ари – загадочная вастайи-лиса/);
});

test("selectWildRiftNewsLoreContent extracts Norra from the official release article", () => {
  const result = selectWildRiftNewsLoreContent({
    titleHeading: "ПОВЕЛИТЕЛЬНИЦА ПОРТАЛОВ",
    headings: ["НОВЫЙ ЧЕМПИОН", "ПОВЕЛИТЕЛЬНИЦА ПОРТАЛОВ"],
    paragraphs: [
      "Встречайте обновление 7.0b!",
      "Йордл Норра, Повелительница порталов, – эксцентричная чародейка из Бандл Сити. Когда-то Норра была хранительницей Книги Пределов. Заблудившись без Книги, она начала экспериментировать с порталами, пытаясь найти дорогу домой.",
    ],
  });

  assert.equal(result.title, "ПОВЕЛИТЕЛЬНИЦА ПОРТАЛОВ");
  assert.match(result.officialLore, /^Йордл Норра/);
});

test("extractGenerationFacts only splits the official page lore into source sentences", () => {
  const lore =
    "Ари связана с магией мира духов. Когда-то она была опасной хищницей. Теперь она создаёт собственные воспоминания.";

  assert.deepEqual(extractGenerationFacts(lore), [
    "Ари связана с магией мира духов.",
    "Когда-то она была опасной хищницей.",
    "Теперь она создаёт собственные воспоминания.",
  ]);
});

test("buildChampionLoreRecord keeps official page provenance and stable hash", () => {
  const input = {
    championSlug: "ahri",
    locale: "ru_RU",
    title: "Девятихвостая лиса",
    officialLore: "Ари связана с магией мира духов. Теперь она создаёт собственные воспоминания.",
    sourceKind: "riot-universe-page",
    sourceUrl: "https://universe.leagueoflegends.com/ru_RU/champion/ahri/",
    canonicalUrl: "https://universe.leagueoflegends.com/ru_RU/champion/ahri/",
  };

  const first = buildChampionLoreRecord(input);
  const second = buildChampionLoreRecord(input);

  assert.equal(first.locale, "ru_ru");
  assert.equal(first.sourceKind, "riot-universe-page");
  assert.equal(first.sourceUrl, input.sourceUrl);
  assert.deepEqual(first.generationFacts, [
    "Ари связана с магией мира духов.",
    "Теперь она создаёт собственные воспоминания.",
  ]);
  assert.equal(first.contentHash, second.contentHash);
});

test("buildChampionLoreRecord rejects a Riot page without lore", () => {
  assert.throws(
    () => buildChampionLoreRecord({
      championSlug: "ahri",
      locale: "ru_RU",
      title: "Девятихвостая лиса",
      officialLore: "",
      sourceKind: "riot-universe-page",
      sourceUrl: "https://universe.leagueoflegends.com/ru_RU/champion/ahri/",
      canonicalUrl: "https://universe.leagueoflegends.com/ru_RU/champion/ahri/",
    }),
    /Official Riot page lore is empty for ahri/,
  );
});
