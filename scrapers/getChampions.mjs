// scrapers/getChampions.mjs
// Единый скрапер чемпионов:
//  - Riot Wild Rift /champions/ -> канонический список slug + ru/en имена
//  - CN hero_list.js + hero/<id>.js -> только enrich уже известных Riot slug-ов
// НИ ОДНОГО JSON-файла на диске.

import { request as httpsRequest } from "node:https";

import {
  buildChampionCatalogFromSources,
  buildRiotChampionCatalog,
} from "../lib/championCatalogSync.mjs";
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
const CN_FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.CN_FETCH_TIMEOUT_MS || 20_000)
);
const CN_FETCH_RETRIES = Math.max(
  1,
  Number(process.env.CN_FETCH_RETRIES || 3)
);
const CN_FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  accept: "application/json,text/javascript,text/plain,*/*",
  referer: "https://lolm.qq.com/",
};
const RIOT_FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.RIOT_FETCH_TIMEOUT_MS || 30_000)
);
const RIOT_FETCH_RETRIES = Math.max(
  1,
  Number(process.env.RIOT_FETCH_RETRIES || 3)
);
const RIOT_FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ru,en;q=0.9",
  referer: "https://wildrift.leagueoflegends.com/",
};

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

async function fetchTextWithRetry(url, label) {
  return await fetchTextWithRetryUsingOptions(url, label, {
    timeoutMs: CN_FETCH_TIMEOUT_MS,
    retries: CN_FETCH_RETRIES,
    headers: CN_FETCH_HEADERS,
    forceIpv4: true,
  });
}

async function fetchTextWithRetryUsingOptions(
  url,
  label,
  { timeoutMs, retries, headers, forceIpv4 = false }
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error(`timeout after ${timeoutMs}ms`)),
      timeoutMs
    );

    try {
      const resText = forceIpv4
        ? await fetchTextViaHttps(url, {
            timeoutMs,
            headers,
            forceIpv4,
          })
        : await fetchTextViaFetch(url, {
            timeoutMs,
            headers,
            signal: controller.signal,
          });
      clearTimeout(timeout);
      return resText;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt < retries) {
        console.warn(
          `[getChampions] ${label} retry ${attempt}/${retries - 1}: ${
            error?.message || String(error)
          }`
        );
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError;
}

async function fetchTextViaFetch(url, { timeoutMs, headers, signal }) {
  const res = await fetch(url, {
    headers,
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`
    );
  }

  return await res.text();
}

function fetchTextViaHttps(
  url,
  { timeoutMs, headers, forceIpv4 = false, redirectCount = 0 }
) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = httpsRequest(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "GET",
        headers,
        family: forceIpv4 ? 4 : undefined,
      },
      (res) => {
        const statusCode = res.statusCode || 0;
        const location = res.headers.location;

        if (
          location &&
          [301, 302, 303, 307, 308].includes(statusCode) &&
          redirectCount < 5
        ) {
          res.resume();
          resolve(
            fetchTextViaHttps(new URL(location, parsedUrl).toString(), {
              timeoutMs,
              headers,
              forceIpv4,
              redirectCount: redirectCount + 1,
            })
          );
          return;
        }

        const chunks = [];
        res.setEncoding("utf8");
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = chunks.join("");

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new Error(
                `HTTP ${statusCode}${body ? `: ${body.slice(0, 160)}` : ""}`
              )
            );
            return;
          }

          resolve(body);
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });

    req.on("error", reject);
    req.end();
  });
}

function decodeHtmlEntities(value) {
  if (!value) return "";

  const namedEntities = {
    quot: '"',
    "#39": "'",
    apos: "'",
    amp: "&",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };

  return String(value).replace(
    /&(?:#\d+|#x[0-9a-f]+|quot|#39|apos|amp|lt|gt|nbsp);/gi,
    (entity) => {
      if (/^&#\d+;$/i.test(entity)) {
        return String.fromCodePoint(Number(entity.slice(2, -1)));
      }

      if (/^&#x[0-9a-f]+;$/i.test(entity)) {
        return String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
      }

      return namedEntities[entity.slice(1, -1).toLowerCase()] ?? entity;
    }
  );
}

function extractHtmlAttribute(source, attributeName) {
  const match = String(source || "").match(
    new RegExp(`${attributeName}=["']([^"']+)["']`, "i")
  );
  return match ? decodeHtmlEntities(match[1].trim()) : "";
}

function stripHtmlTags(source) {
  return decodeHtmlEntities(String(source || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractRiotChampionCardsFromHtml(html) {
  const cards = [];
  const seenSlugs = new Set();
  const anchorPattern =
    /<a\b([^>]*)href=["']([^"']*\/champions\/([^/"'#?]+)\/[^"']*)["']([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const attrs = `${match[1] || ""} ${match[4] || ""}`;
    const slug = String(match[3] || "").trim().toLowerCase();
    if (!slug || seenSlugs.has(slug)) continue;

    const ariaLabel = extractHtmlAttribute(attrs, "aria-label");
    const titleMatch = String(match[5] || "").match(
      /<[^>]*data-testid=["']card-title["'][^>]*>([\s\S]*?)<\/[^>]+>/i
    );
    const titleText = titleMatch ? stripHtmlTags(titleMatch[1]) : "";
    const fallbackText = stripHtmlTags(match[5]);
    const name = ariaLabel || titleText || fallbackText;

    if (!name) continue;

    seenSlugs.add(slug);
    cards.push({
      slug,
      name,
    });
  }

  return cards;
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
  const text = await fetchTextWithRetry(HERO_LIST_URL, "hero_list.js");

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
  const text = await fetchTextWithRetry(url, `hero detail heroId=${heroId}`);
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

async function fetchRiotChampionsHtml(locale) {
  const listUrl = `${BASE_URL_RIOT}${locale.path}/champions/`;
  console.log(`\n[names] ${locale.key}: ${listUrl}`);
  return await fetchTextWithRetryUsingOptions(listUrl, `riot champions ${locale.key}`, {
    timeoutMs: RIOT_FETCH_TIMEOUT_MS,
    retries: RIOT_FETCH_RETRIES,
    headers: RIOT_FETCH_HEADERS,
  });
}

async function scrapeRiotNames() {
  /** Map<locale, Map<slug, { [locale]: string }>> */
  const byLocale = new Map();

  for (const locale of RIOT_NAME_LOCALES) {
    const html = await fetchRiotChampionsHtml(locale);
    const champs = extractRiotChampionCardsFromHtml(html);

    console.log(`[names] ${locale.key}: найдено чемпионов: ${champs.length}`);

    const localeMap = new Map();

    for (const { slug, name } of champs) {
      localeMap.set(slug, {
        [locale.key]: name,
      });
    }

    byLocale.set(locale.key, localeMap);
  }

  return byLocale;
}

function buildCnHeroListItems(heroList = {}) {
  return Object.entries(heroList)
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
}

async function fetchCnChampionDetails(items) {
  const failed = [];
  const champions = await mapWithConcurrency(
    items,
    DETAIL_CONCURRENCY,
    async ({ heroId, slug, heroObj }) => {
      try {
        const rawJson = await fetchHeroDetailRaw(heroId);
        return buildChampionFromCn(slug, heroId, heroObj, rawJson);
      } catch (error) {
        failed.push({
          heroId,
          slug,
          error: error?.message || String(error),
        });
        console.error(`❌ CN heroId=${heroId}, slug=${slug}:`, error?.message || error);
        return null;
      }
    },
  );

  return {
    champions: champions.filter(Boolean),
    failed,
  };
}

function localizeChampionCatalog(champions = []) {
  for (const champ of champions) {
    if (!Array.isArray(champ.roles)) {
      champ.roles = [];
    }

    const roleLabels = champ.roles
      .map((key) => ROLE_LABELS[key])
      .filter(Boolean);

    champ.rolesLocalized = {
      ru_ru: roleLabels.map((r) => r.ru_ru),
      en_us: roleLabels.map((r) => r.en_us),
      zh_cn: roleLabels.map((r) => r.zh_cn),
    };

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
}

function logChampionCatalogReport(report) {
  const riotDiagnostics = report?.steps?.riotCatalog || {};
  const cnDiagnostics = report?.steps?.cnCatalog || {};
  const mergeDiagnostics = report?.steps?.merge || {};

  console.log(
    `[getChampions] riot catalog -> ru=${riotDiagnostics.ruCount || 0} en=${riotDiagnostics.enCount || 0} merged=${riotDiagnostics.mergedCount || 0}`,
  );

  if (Array.isArray(riotDiagnostics.addedFromEnOnly) && riotDiagnostics.addedFromEnOnly.length) {
    console.warn(
      `[getChampions] added temporary en-only Riot champions until ru page catches up: ${riotDiagnostics.addedFromEnOnly.join(", ")}`,
    );
  }

  if (
    (Array.isArray(riotDiagnostics.ruOnly) && riotDiagnostics.ruOnly.length) ||
    (Array.isArray(riotDiagnostics.enOnly) &&
      riotDiagnostics.enOnly.length &&
      !(Array.isArray(riotDiagnostics.addedFromEnOnly) && riotDiagnostics.addedFromEnOnly.length))
  ) {
    console.warn(
      `[getChampions] Riot locale mismatch detected -> ruOnly=${riotDiagnostics.ruOnly?.join(", ") || "-"} enOnly=${riotDiagnostics.enOnly?.join(", ") || "-"}`,
    );
  }

  console.log(
    `[getChampions] cn catalog -> heroList=${cnDiagnostics.heroListCount || 0} detailed=${cnDiagnostics.detailCount || 0} detailFailures=${cnDiagnostics.detailFailures || 0}`,
  );

  console.log(
    `[getChampions] merge -> riot=${mergeDiagnostics.riotChampionCount || 0} cn=${mergeDiagnostics.cnChampionCount || 0} merged=${report?.champions?.length || 0}`,
  );

  if (Array.isArray(mergeDiagnostics.missingCnDetails) && mergeDiagnostics.missingCnDetails.length) {
    console.warn(
      `[getChampions] Riot champions without CN enrichment: ${mergeDiagnostics.missingCnDetails.join(", ")}`,
    );
  }

  if (Array.isArray(mergeDiagnostics.excludedCnOnly) && mergeDiagnostics.excludedCnOnly.length) {
    console.warn(
      `[getChampions] CN champions excluded because absent on Riot page: ${mergeDiagnostics.excludedCnOnly
        .map((entry) => `${entry.cnSlug}->${entry.riotSlug}`)
        .join(", ")}`,
    );
  }

  if (Array.isArray(mergeDiagnostics.duplicateCnMappings) && mergeDiagnostics.duplicateCnMappings.length) {
    console.warn(
      `[getChampions] duplicate CN slug mappings: ${mergeDiagnostics.duplicateCnMappings
        .map((entry) => `${entry.ignoredSlug}->${entry.riotSlug} (kept ${entry.keptSlug})`)
        .join(", ")}`,
    );
  }

  if (Array.isArray(cnDiagnostics.failedSamples) && cnDiagnostics.failedSamples.length) {
    console.warn(
      `[getChampions] CN detail fetch failures: ${cnDiagnostics.failedSamples
        .map((entry) => `${entry.slug}:${entry.error}`)
        .join(" | ")}`,
    );
  }
}

export async function runChampionCatalogScrape() {
  const riotLocaleNames = await scrapeRiotNames();
  const { riotNames, diagnostics: riotDiagnostics } = buildRiotChampionCatalog({
    ruNames: riotLocaleNames.get("ru_ru"),
    enNames: riotLocaleNames.get("en_us"),
  });

  const heroList = await fetchHeroList();
  const heroListItems = buildCnHeroListItems(heroList);
  const cnDetails = await fetchCnChampionDetails(heroListItems);

  const { champions, diagnostics } = buildChampionCatalogFromSources({
    riotNames,
    cnChampions: cnDetails.champions,
    namePatches: NAME_PATCHES,
  });

  localizeChampionCatalog(champions);

  const report = {
    champions,
    steps: {
      riotCatalog: riotDiagnostics,
      cnCatalog: {
        heroListCount: heroListItems.length,
        detailCount: cnDetails.champions.length,
        detailFailures: cnDetails.failed.length,
        failedSamples: cnDetails.failed.slice(0, 10),
      },
      merge: diagnostics,
    },
  };

  logChampionCatalogReport(report);
  return report;
}

// ----- Публичный API -----

export async function getChampions() {
  const report = await runChampionCatalogScrape();
  return report.champions;
}
