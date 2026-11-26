import { createHash } from "node:crypto";

import puppeteer from "puppeteer";

import { getSourceChampionSlugCandidates } from "./championSlug.mjs";

/* global document, Node */

const UNIVERSE_ORIGIN = "https://universe.leagueoflegends.com";
const LEAGUE_ORIGIN = "https://www.leagueoflegends.com";
const WILD_RIFT_ORIGIN = "https://wildrift.leagueoflegends.com";

const PAGE_SOURCE_OVERRIDES = {
  norra: {
    sourceKind: "riot-wild-rift-news-page",
    sourceUrl: `${WILD_RIFT_ORIGIN}/ru-ru/news/game-updates/wild-rift-patch-notes-7-0b/`,
    canonicalUrl: `${WILD_RIFT_ORIGIN}/ru-ru/champions/norra/`,
    titleHeading: "ПОВЕЛИТЕЛЬНИЦА ПОРТАЛОВ",
  },
};

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLoreLocale(value = "ru_RU") {
  const normalized = String(value || "ru_RU").trim().replace("-", "_");
  if (normalized.toLowerCase() === "ru_ru") return "ru_RU";
  if (normalized.toLowerCase() === "en_us") return "en_US";
  return normalized;
}

export function toStoredLoreLocale(value = "ru_RU") {
  return normalizeLoreLocale(value).toLowerCase();
}

export function extractGenerationFacts(officialLore) {
  const lore = cleanText(officialLore);
  if (!lore) return [];

  return lore
    .split(/(?<=[.!?])\s+(?=[А-ЯA-ZЁ«“])/u)
    .map(cleanText)
    .filter((fact) => fact.length >= 20);
}

export function selectUniverseLoreContent({ headings = [], paragraphs = [], championName }) {
  const title = headings
    .map(cleanText)
    .find((value) => value && value !== cleanText(championName).toUpperCase()) || null;
  const officialLore = paragraphs
    .map(cleanText)
    .find((value) => value.length >= 120) || null;

  return { title, officialLore };
}

export function selectWildRiftNewsLoreContent({ headings = [], paragraphs = [], titleHeading }) {
  const normalizedHeading = cleanText(titleHeading).toLocaleUpperCase("ru-RU");
  const title = headings
    .map(cleanText)
    .find((value) => value.toLocaleUpperCase("ru-RU") === normalizedHeading) || null;
  const officialLore = paragraphs
    .map(cleanText)
    .find((value) => value.length >= 120 && value.startsWith("Йордл Норра,")) || null;

  return { title, officialLore };
}

export function buildChampionLoreRecord({
  championSlug,
  locale,
  title,
  officialLore,
  sourceKind,
  sourceUrl,
  canonicalUrl,
}) {
  const cleanedLore = cleanText(officialLore);
  if (!cleanedLore) throw new Error(`Official Riot page lore is empty for ${championSlug}`);

  const record = {
    championSlug,
    locale: toStoredLoreLocale(locale),
    title: cleanText(title) || null,
    shortLore: cleanedLore,
    officialLore: cleanedLore,
    generationFacts: extractGenerationFacts(cleanedLore),
    sourceKind,
    sourceUrl,
    canonicalUrl,
  };

  return {
    ...record,
    contentHash: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
  };
}

function buildUniverseUrl(slug, locale) {
  return `${UNIVERSE_ORIGIN}/${normalizeLoreLocale(locale)}/champion/${slug}/`;
}

function buildUniverseBiographyUrl(slug, locale) {
  return `${UNIVERSE_ORIGIN}/${normalizeLoreLocale(locale)}/story/champion/${slug}/`;
}

function buildLeagueChampionUrl(slug, locale) {
  const webLocale = normalizeLoreLocale(locale).replace("_", "-").toLowerCase();
  return `${LEAGUE_ORIGIN}/${webLocale}/champions/${slug}/`;
}

async function preparePage(page) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (["image", "media", "font"].includes(request.resourceType())) {
      request.abort();
    } else {
      request.continue();
    }
  });
}

async function readUniversePage(page, { championSlug, championName, locale }) {
  const sourceUrl = buildUniverseUrl(championSlug, locale);
  const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response?.ok()) throw new Error(`HTTP ${response?.status() || "unknown"} for ${sourceUrl}`);

  await page.waitForFunction(() => {
    const titleNode = document.querySelector('h3[class*="subheadline_"]');
    if (!titleNode) return false;
    return [...document.querySelectorAll("p")].some((node) => {
      const followsTitle = Boolean(titleNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
      return followsTitle && text.length >= 120;
    });
  }, { timeout: 30_000 });

  const pageData = await page.evaluate(() => ({
    headings: [...document.querySelectorAll('h3[class*="subheadline_"]')].map((node) => node.textContent),
    paragraphs: (() => {
      const titleNode = document.querySelector('h3[class*="subheadline_"]');
      return [...document.querySelectorAll("p")]
        .filter((node) => titleNode && (titleNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
        .map((node) => node.textContent);
    })(),
  }));
  const content = selectUniverseLoreContent({ ...pageData, championName });
  return {
    ...content,
    sourceKind: "riot-universe-page",
    sourceUrl,
    canonicalUrl: sourceUrl,
  };
}

async function readUniverseBiographyPage(page, { championSlug, locale }) {
  const sourceUrl = buildUniverseBiographyUrl(championSlug, locale);
  const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response?.ok()) throw new Error(`HTTP ${response?.status() || "unknown"} for ${sourceUrl}`);

  const pageData = await page.evaluate(() => ({
    title: document.querySelector('meta[property="og:title"]')?.content
      || document.querySelector("title")?.textContent,
    officialLore: document.querySelector('meta[name="description"]')?.content
      || document.querySelector('meta[property="og:description"]')?.content,
  }));
  const officialLore = cleanText(pageData.officialLore);
  if (officialLore.length < 300) {
    throw new Error(`Full official biography is missing for ${championSlug}`);
  }

  return {
    title: cleanText(pageData.title)?.replace(/\s*-\s*Биография.*$/u, "") || null,
    officialLore,
    sourceKind: "riot-universe-biography",
    sourceUrl,
    canonicalUrl: sourceUrl,
  };
}

async function readLeagueChampionPage(page, { championSlug, locale }) {
  const sourceUrl = buildLeagueChampionUrl(championSlug, locale);
  const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  if (!response?.ok()) throw new Error(`HTTP ${response?.status() || "unknown"} for ${sourceUrl}`);

  await page.waitForFunction(() => [...document.querySelectorAll("p")]
    .some((node) => String(node.textContent || "").replace(/\s+/g, " ").trim().length >= 120),
  { timeout: 30_000 });
  const pageData = await page.evaluate(() => ({
    headings: [...document.querySelectorAll("h1,h2,h3")].map((node) => node.textContent),
    paragraphs: [...document.querySelectorAll("p")].map((node) => node.textContent),
  }));
  const content = selectUniverseLoreContent({ ...pageData, championName: championSlug });
  return {
    ...content,
    sourceKind: "riot-league-champion-page",
    sourceUrl,
    canonicalUrl: sourceUrl,
  };
}

async function readWildRiftOverridePage(page, override) {
  const response = await page.goto(override.sourceUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  if (!response?.ok()) {
    throw new Error(`HTTP ${response?.status() || "unknown"} for ${override.sourceUrl}`);
  }

  await page.waitForFunction(
    (titleHeading) => [...document.querySelectorAll("h2,h3")]
      .some((node) => String(node.textContent || "").trim() === titleHeading),
    { timeout: 20_000 },
    override.titleHeading,
  );
  const pageData = await page.evaluate(() => ({
    headings: [...document.querySelectorAll("h2,h3")].map((node) => node.textContent),
    paragraphs: [...document.querySelectorAll("p")].map((node) => node.textContent),
  }));
  const content = selectWildRiftNewsLoreContent({
    ...pageData,
    titleHeading: override.titleHeading,
  });
  return { ...content, ...override };
}

export async function createOfficialRiotLorePageSource({ locale = "ru_RU" } = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  return {
    locale: normalizeLoreLocale(locale),
    async loadChampion(champion) {
      const page = await browser.newPage();
      await preparePage(page);
      try {
        const override = PAGE_SOURCE_OVERRIDES[champion.slug];
        if (override) return await readWildRiftOverridePage(page, override);
        const championName = champion?.nameLocalizations?.ru_ru || champion?.name;
        const slugCandidates = getSourceChampionSlugCandidates(champion.slug, "riot");
        let lastError = null;
        for (const championSlug of slugCandidates) {
          try {
            return await readUniverseBiographyPage(page, { championSlug, locale });
          } catch (error) {
            lastError = error;
          }
        }
        for (const championSlug of slugCandidates) {
          try {
            return await readUniversePage(page, { championSlug, championName, locale });
          } catch (error) {
            lastError = error;
          }
        }
        for (const championSlug of slugCandidates) {
          try {
            return await readLeagueChampionPage(page, { championSlug, locale });
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error(`No official Riot champion page for ${champion.slug}`);
      } finally {
        await page.close();
      }
    },
    async close() {
      await browser.close();
    },
  };
}
