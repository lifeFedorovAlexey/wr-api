// scrapers/getChampions.mjs
// Единый скрапер чемпионов:
//  - CN: hero_list.js + hero/<id>.js → cnHeroId, zh-cn имя, icon, roles[], difficulty
//  - Riot Wild Rift: /champions/ → ru/en имена
// НИ ОДНОГО JSON-файла на диске.

import puppeteer from "puppeteer";
import { mapToRiotSlug } from "../utils/slugRemap.mjs";
import { NAME_PATCHES } from "../utils/slugRemap.mjs";

// ----- Константы китайских эндпоинтов -----

// Список героев (ID + poster + alias и т.п.)
const HERO_LIST_URL =
  "https://game.gtimg.cn/images/lgamem/act/lrlib/js/heroList/hero_list.js";

// Детали героя (heroId.js)
const HERO_DETAIL_URL = (heroId) =>
  `https://game.gtimg.cn/images/lgamem/act/lrlib/js/hero/${heroId}.js`;

// Ограничение параллелизма при скачивании деталей
const DETAIL_CONCURRENCY = 8;

// ----- Riot Wild Rift -----

const BASE_URL_RIOT =
  process.env.BASE_URL_RIOT || "https://wildrift.leagueoflegends.com";

// используем только эти локали для имён
const RIOT_NAME_LOCALES = [
  { key: "ru_ru", path: "/ru-ru" },
  { key: "en_us", path: "/en-us" },
];

// ----- Маппинги ролей/сложности -----

// Китайские роли → ключи API
const CN_ROLE_MAP = {
  战士: "fighter",
  法师: "mage",
  刺客: "assassin",
  坦克: "tank",
  射手: "marksman",
  辅助: "support",
};

// Локализации ролей по ключу
const ROLE_LABELS = {
  fighter: {
    ru_ru: "Боец",
    en_us: "Fighter",
    zh_cn: "战士",
  },
  mage: {
    ru_ru: "Маг",
    en_us: "Mage",
    zh_cn: "法师",
  },
  assassin: {
    ru_ru: "Убийца",
    en_us: "Assassin",
    zh_cn: "刺客",
  },
  tank: {
    ru_ru: "Танк",
    en_us: "Tank",
    zh_cn: "坦克",
  },
  marksman: {
    ru_ru: "Стрелок",
    en_us: "Marksman",
    zh_cn: "射手",
  },
  support: {
    ru_ru: "Поддержка",
    en_us: "Support",
    zh_cn: "辅助",
  },
};

// Локализации сложности по ключу
const DIFFICULTY_LABELS = {
  easy: {
    ru_ru: "Лёгкая",
    en_us: "Easy",
    zh_cn: "简单",
  },
  medium: {
    ru_ru: "Средняя",
    en_us: "Medium",
    zh_cn: "中等",
  },
  hard: {
    ru_ru: "Сложная",
    en_us: "Hard",
    zh_cn: "困难",
  },
};

const DIFFICULTY_KEY_FROM_SCORE = (scoreRaw) => {
  const n = safeNumber(scoreRaw);
  if (n == null) return "medium";

  if (n === 1) return "easy";
  if (n === 2) return "medium";
  if (n === 3) return "hard";

  // если вдруг когда-нибудь появятся другие значения
  return "medium";
};

// ----- Общие хелперы -----

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normSlug(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function slugFromPoster(poster) {
  if (!poster) return null;
  try {
    const file = poster.split("/").pop();
    if (!file) return null;
    const base = file.split("_")[0];
    if (!base) return null;
    return normSlug(base);
  } catch {
    return null;
  }
}

function parseMaybeWrappedJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Не удалось вытащить JSON из hero detail файла");
    }
    return JSON.parse(match[0]);
  }
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Примитивный пул для ограничения параллелизма
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      results[i] = await fn(item, i);
    }
  }

  const workers = [];
  const workerCount = Math.min(limit, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// ----- 1. hero_list.js: получить список героев (CN) -----

async function fetchHeroList() {
  const res = await fetch(HERO_LIST_URL);
  if (!res.ok) {
    throw new Error(
      `Не удалось скачать hero_list.js: ${res.status} ${res.statusText}`
    );
  }

  const text = await res.text();

  // hero_list.js иногда бывает чистым JSON, иногда - обёрнутым
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Не удалось распарсить hero_list.js");
    }
    json = JSON.parse(match[0]);
  }

  const heroList = json.heroList || {};
  return heroList; // { [heroId]: heroObj }
}

// ----- 2. Детали героя: hero/<id>.js (CN) -----

async function fetchHeroDetailRaw(heroId) {
  const url = HERO_DETAIL_URL(heroId);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Не удалось скачать hero detail для heroId=${heroId}: ${res.status} ${res.statusText}`
    );
  }

  const text = await res.text();
  return parseMaybeWrappedJson(text);
}

// Нормализация одного чемпиона из CN-данных
function buildChampionFromCn(slug, heroId, heroObj, rawJson) {
  const hero = rawJson.hero || {};

  const avatar = hero.avatar || null;
  const card = hero.card || null;
  const poster = hero.poster || heroObj?.poster || null;

  const cnHeroId = hero.heroId ? String(hero.heroId) : String(heroId);

  const zhName = hero.name ?? null;

  // ----- роли из китайских данных -----
  const rolesRaw = Array.isArray(hero.roles) ? hero.roles : [];
  const roleKeys = [];
  const seenRoles = new Set();

  for (const r of rolesRaw) {
    const key = CN_ROLE_MAP[String(r)] || null;
    if (!key) continue;
    if (seenRoles.has(key)) continue;
    seenRoles.add(key);
    roleKeys.push(key);
  }

  // ----- сложность из difficultyL -----
  const difficultyKey = DIFFICULTY_KEY_FROM_SCORE(hero.difficultyL);

  const icon = avatar || card || poster || null;

  return {
    slug,
    cnHeroId,
    names: {
      ru_ru: null,
      en_us: null,
      zh_cn: zhName,
    },
    roles: roleKeys,
    difficulty: difficultyKey,
    icon,
  };
}

// ----- 3. Riot: имена по локалям (грид /champions/) -----

async function scrapeRiotNames(browser) {
  /** Map<slug, { ru_ru?: string, en_us?: string }> */
  const bySlug = new Map();

  for (const locale of RIOT_NAME_LOCALES) {
    const page = await browser.newPage();
    const listUrl = `${BASE_URL_RIOT}${locale.path}/champions/`;

    console.log(`\n[names] ${locale.key}: ${listUrl}`);
    await page.goto(listUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await sleep(2000);

    const champs = await page.evaluate(() => {
      const result = [];

      const grid = document.querySelector('[data-testid="card-grid"]');
      if (!grid) {
        console.warn("⚠️ [names] card-grid не найден");
        return result;
      }

      const cards = grid.querySelectorAll('a[role="button"][aria-label]');

      cards.forEach((a) => {
        const href = a.getAttribute("href") || "";
        const ariaLabel = a.getAttribute("aria-label") || "";

        let slug = null;
        const m = href.match(/\/champions\/([^/]+)\//);
        if (m) slug = m[1];

        const titleEl = a.querySelector('[data-testid="card-title"]');
        const titleText = (titleEl?.textContent || "").trim();

        const nameLocalized = ariaLabel || titleText;

        if (!slug || !nameLocalized) return;

        result.push({
          slug,
          name: nameLocalized,
        });
      });

      return result;
    });

    console.log(`[names] ${locale.key}: найдено чемпионов: ${champs.length}`);

    for (const { slug, name } of champs) {
      if (!bySlug.has(slug)) bySlug.set(slug, {});
      bySlug.get(slug)[locale.key] = name;
    }

    await page.close();
  }

  return bySlug;
}

// ----- Публичный API -----

export async function getChampions() {
  // Поднимаем браузер один раз
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    // 1) Китай: hero_list.js → список { heroId, heroObj, slug }
    const heroList = await fetchHeroList();
    const entries = Object.entries(heroList); // [ [heroId, heroObj], ... ]

    const items = entries
      .map(([heroId, hero]) => {
        const poster = hero.poster;
        const alias = hero.alias;
        const slugFromPosterVal = slugFromPoster(poster);
        const slug = slugFromPosterVal || normSlug(alias);

        if (!slug) {
          return null;
        }

        return {
          heroId: String(heroId),
          slug,
          heroObj: hero,
        };
      })
      .filter(Boolean);

    // 2) Китай: детали по heroId → cnHeroId, zh_cn, icon, roles, difficulty
    const cnChampions = await mapWithConcurrency(
      items,
      DETAIL_CONCURRENCY,
      async ({ heroId, slug, heroObj }) => {
        try {
          const rawJson = await fetchHeroDetailRaw(heroId);
          return buildChampionFromCn(slug, heroId, heroObj, rawJson);
        } catch (e) {
          console.error(
            `❌ CN heroId=${heroId}, slug=${slug}:`,
            e?.message || e
          );
          return null;
        }
      }
    );

    const champions = cnChampions.filter(Boolean);

    // 3) Riot: имена (ru_ru, en_us) с гридов /champions/
    const riotNames = await scrapeRiotNames(browser);

    // 4) Мержим: имена с Riot, роли/сложность локализуем через маппинг
    for (const champ of champions) {
      const riotSlug = mapToRiotSlug(champ.slug);

      // Имена из Riot
      const localeNames = riotNames.get(riotSlug) || {};
      champ.names = {
        ...(champ.names || {}),
        ...localeNames,
      };

      // Ручной фикс имён (если после скрапа что-то не нашлось)
      const patch = NAME_PATCHES[champ.slug];
      if (patch) {
        champ.names = {
          ...champ.names,
          ...patch,
        };
      }

      // Роли – гарантированно массив ключей
      if (!Array.isArray(champ.roles)) {
        champ.roles = [];
      }

      // Локализованные роли "как имя"
      const roleLabels = champ.roles
        .map((key) => ROLE_LABELS[key])
        .filter(Boolean);

      champ.rolesLocalized = {
        ru_ru: roleLabels.map((r) => r.ru_ru),
        en_us: roleLabels.map((r) => r.en_us),
        zh_cn: roleLabels.map((r) => r.zh_cn),
      };

      // Локализованная сложность
      const diffLabels = DIFFICULTY_LABELS[champ.difficulty] || null;
      champ.difficultyLocalized = diffLabels
        ? {
            ru_ru: diffLabels.ru_ru,
            en_us: diffLabels.en_us,
            zh_cn: diffLabels.zh_cn,
          }
        : null;
    }

    return champions;
  } finally {
    await browser.close();
  }
}
