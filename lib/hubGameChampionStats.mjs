import { load } from "cheerio";

const SOURCE_URL = "https://hub-game.com/wildrift/en/champions/stats";
const SOURCE_KIND = "hub-game-champion-stats-baseline";
const REQUIRED_COLUMNS = [
  "champion", "health", "mana", "attack", "armor", "magic resist", "movement speed",
  "damage", "survive", "utility", "difficulty",
];

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function validateSourceUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new TypeError("sourceUrl must be a valid URL");
  }
  if (parsed.protocol !== "https:" || !["hub-game.com", "www.hub-game.com"].includes(parsed.hostname)) {
    throw new TypeError("sourceUrl must use the HTTPS Hub Game domain");
  }
  if (parsed.pathname.replace(/\/$/, "") !== "/wildrift/en/champions/stats") {
    throw new TypeError("sourceUrl must be Hub Game's champion stats page");
  }
}

function sourceMetadata(text) {
  const match = text.match(/League of Legends:\s*Wild Rift\s*\(China\)\s*official champion library\s*\(patch\s+(\d+\.\d+[a-z]?),\s*as of\s+(\d{4}-\d{2}-\d{2})\),\s*with the official global patch notes applied up to\s+(\d+\.\d+[a-z]?)(?!\.\d)(?=[A-Z\s,;.)]|$)/);
  const countMatch = text.match(/for all\s+(\d[\d,]*)\s+champions/i);
  if (!match || !countMatch) {
    throw new Error("Hub Game champion stats page is missing source version, date, global patch, or champion count metadata");
  }
  const count = Number(countMatch[1].replaceAll(",", ""));
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("Hub Game champion stats page has an invalid champion count");
  }
  return {
    chinaLibraryPatch: match[1],
    chinaLibraryAsOf: match[2],
    globalPatchThrough: match[3],
    count,
  };
}

function headerNames(table, $) {
  return table.find("thead tr").first().find("th").toArray()
    .map((cell) => cleanText($(cell).text()).toLowerCase());
}

function assertHeaders(headers) {
  const normalized = headers.filter((name) => name !== "#");
  if (REQUIRED_COLUMNS.some((name, index) => normalized[index] !== name) || normalized.length !== REQUIRED_COLUMNS.length) {
    throw new Error("Hub Game champion stats table has an unexpected column layout");
  }
}

function numberFromCell(cellText, label, { nullable = false, percent = false } = {}) {
  const text = cleanText(cellText);
  if (nullable && ["—", "–", "-", ""].includes(text)) return null;
  const pattern = percent ? /^([\d,.]+)\s*\(\s*([\d,.]+)\s*%\s*\)$/ : /^([\d,.]+)$/;
  const match = text.match(pattern);
  if (!match) throw new Error(`Hub Game champion row has invalid ${label}: ${text || "empty"}`);
  const value = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(value)) throw new Error(`Hub Game champion row has non-finite ${label}`);
  if (!percent) return value;
  const percentage = Number(match[2].replaceAll(",", ""));
  if (!Number.isFinite(percentage)) throw new Error(`Hub Game champion row has invalid ${label} percentage`);
  return { value, percent: percentage };
}

function ratingFromCell(cell, $, label) {
  const value = cleanText($(cell).find("[role='img'][aria-label]").attr("aria-label"));
  const match = value.match(new RegExp(`^${label}:\\s*(\\d+)\\s+of\\s+(\\d+)$`, "i"));
  if (!match) throw new Error(`Hub Game champion row has missing ${label} rating`);
  const rating = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isSafeInteger(rating) || !Number.isSafeInteger(max) || rating < 0 || max < 1 || rating > max) {
    throw new Error(`Hub Game champion row has invalid ${label} rating`);
  }
  return { value: rating, max };
}

function canonicalChampionSlug(href, sourceUrl) {
  let url;
  try {
    url = new URL(href, sourceUrl);
  } catch {
    throw new Error("Hub Game champion row has an invalid champion link");
  }
  if (url.origin !== new URL(sourceUrl).origin || !url.pathname.startsWith("/wildrift/en/champions/")) {
    throw new Error("Hub Game champion row has a non-canonical champion link");
  }
  const pathSlug = url.pathname.slice("/wildrift/en/champions/".length).replace(/\/$/, "");
  if (!pathSlug || pathSlug.includes("/")) throw new Error("Hub Game champion row has an invalid champion slug");
  return { slug: pathSlug.toLowerCase(), hubSlug: pathSlug };
}

function parseChampionRow(row, $, sourceUrl) {
  const cells = $(row).children("td").toArray();
  if (cells.length !== 12) throw new Error("Hub Game champion stats row has an unexpected number of cells");
  const nameLink = $(cells[1]).find("a[href]").first();
  const name = cleanText(nameLink.text());
  if (!name) throw new Error("Hub Game champion row has an empty name");
  const { slug, hubSlug } = canonicalChampionSlug(nameLink.attr("href"), sourceUrl);
  const armor = numberFromCell($(cells[5]).text(), "armor", { percent: true });
  const magicResist = numberFromCell($(cells[6]).text(), "magic resist", { percent: true });
  return {
    slug,
    hubSlug,
    name,
    statsAtLevel1: {
      health: numberFromCell($(cells[2]).text(), "health"),
      mana: numberFromCell($(cells[3]).text(), "mana", { nullable: true }),
      attack: numberFromCell($(cells[4]).text(), "attack"),
      armor: armor.value,
      armorDamageReductionPercent: armor.percent,
      magicResist: magicResist.value,
      magicDamageReductionPercent: magicResist.percent,
      movementSpeed: numberFromCell($(cells[7]).text(), "movement speed"),
    },
    ratings: {
      damage: ratingFromCell(cells[8], $, "Damage"),
      survive: ratingFromCell(cells[9], $, "Survive"),
      utility: ratingFromCell(cells[10], $, "Utility"),
      difficulty: ratingFromCell(cells[11], $, "Difficulty"),
    },
  };
}

function validateChampions(champions, expectedCount) {
  if (champions.length !== expectedCount) {
    throw new Error(`Hub Game champion count mismatch: metadata says ${expectedCount}, parsed ${champions.length}`);
  }
  const slugs = new Set();
  for (const champion of champions) {
    if (slugs.has(champion.slug)) throw new Error(`Hub Game champion stats table contains duplicate slug: ${champion.slug}`);
    slugs.add(champion.slug);
    for (const [field, value] of Object.entries(champion.statsAtLevel1)) {
      if (field === "mana" && value === null) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`Hub Game champion ${champion.slug} has missing or invalid level-1 ${field}`);
      }
    }
  }
}

/**
 * Parse Hub Game's rendered global champion base-stat table.
 * This is a current baseline snapshot; it is not a historical per-patch state.
 */
export function parseHubGameChampionStats(html, sourceUrl = SOURCE_URL) {
  if (typeof html !== "string" || html.trim().length < 100) {
    throw new TypeError("html must contain the rendered Hub Game champion stats table");
  }
  validateSourceUrl(sourceUrl);
  const $ = load(html);
  if (cleanText($("h1").first().text()) !== "Base Stats for Every Champion") {
    throw new Error("Hub Game champion stats page heading was not found");
  }
  const metadata = sourceMetadata(cleanText($("body").text()));
  const tables = $("table").toArray().map((table) => $(table));
  const statsTable = tables.find((table) => {
    const headers = headerNames(table, $);
    return headers[0] === "#" && headers[1] === "champion";
  });
  if (!statsTable) throw new Error("Hub Game champion stats table was not found");
  assertHeaders(headerNames(statsTable, $));
  const champions = statsTable.find("tbody tr").toArray().map((row) => parseChampionRow(row, $, sourceUrl));
  validateChampions(champions, metadata.count);

  return {
    sourceKind: SOURCE_KIND,
    sourceUrl,
    baselineKind: "current-global-champion-stats",
    chinaLibraryPatch: metadata.chinaLibraryPatch,
    chinaLibraryAsOf: metadata.chinaLibraryAsOf,
    globalPatchThrough: metadata.globalPatchThrough,
    count: champions.length,
    champions,
  };
}
