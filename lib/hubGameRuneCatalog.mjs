import { load } from "cheerio";

const SOURCE_KIND = "hub-game";
const RUNE_IMAGE_PATH = "/wildrift/images/runes/";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function validateSourceUrl(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new TypeError("sourceUrl must be a valid URL");
  }
  if (url.protocol !== "https:" || !["hub-game.com", "www.hub-game.com"].includes(url.hostname)) {
    throw new TypeError("sourceUrl must use the HTTPS Hub Game domain");
  }
  if (!/^\/wildrift\/en\/runes\/?$/i.test(url.pathname)) {
    throw new TypeError("sourceUrl must identify the Hub Game rune catalog");
  }
}

function snapshotMetadata($) {
  const text = cleanText($("body").text());
  const sourceMatch = text.match(/Effects and values:.*?through patch\s+([\w.]+)\s+\(updated\s+(\d{4}-\d{2}-\d{2})\)/i);
  let countInLabel = null;
  let countInTotal = null;
  let searchFrom = 0;
  while (!countInLabel && searchFrom >= 0) {
    const countMarker = text.indexOf(" of ", searchFrom);
    if (countMarker < 0) break;
    const labelMatch = text.slice(0, countMarker).match(/(\d+)$/);
    const totalMatch = text.slice(countMarker + 4).match(/^(\d+) runes/i);
    if (labelMatch && totalMatch) {
      countInLabel = labelMatch;
      countInTotal = totalMatch;
      break;
    }
    searchFrom = countMarker + 4;
  }
  if (!sourceMatch) throw new Error("Hub Game rune catalog is missing snapshot version or date metadata");
  if (!countInLabel || !countInTotal) throw new Error("Hub Game rune catalog is missing rune count metadata");
  const count = Number(countInLabel[1]);
  const declaredCount = Number(countInTotal[1]);
  if (!Number.isInteger(count) || count < 1 || count !== declaredCount) {
    throw new Error("Hub Game rune catalog has an invalid displayed rune count");
  }
  const translatedFromJapanese = /Some English rune descriptions are translated from the Japanese client/i.test(text);
  return {
    version: sourceMatch[1],
    updatedAt: sourceMatch[2],
    count,
    translatedFromJapanese,
  };
}

function runeSlug(imageUrl) {
  const filename = new URL(imageUrl, "https://hub-game.com").pathname.split("/").at(-1) ?? "";
  const basename = filename.replace(/\.[^.]+$/, "");
  return basename.toLowerCase().replaceAll("_", "-");
}

function cardBadges($, card) {
  const heading = $(card).find("h3").first();
  const badgeContainer = heading.parent().children("div").toArray()
    .find((element) => $(element).children("span").length > 0);
  return badgeContainer
    ? $(badgeContainer).children("span").toArray()
      .map((element) => cleanText($(element).clone().find("svg,[aria-hidden='true']").remove().end().text()))
      .filter(Boolean)
    : [];
}

function effectText($, card) {
  const effect = $(card).find("div.text-sm.text-slate-600.font-medium.leading-relaxed span.line-clamp-2").first();
  return effect.length ? effect.text().split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}

function valueLines(lines) {
  return lines.slice(1).flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) return [];
    return [{ label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() }];
  });
}

function parseRuneCard($, card, sourceUrl) {
  const heading = $(card).find("h3").first();
  const name = cleanText(heading.find("[title]").first().attr("title") || heading.text());
  const rawImage = $(card).find(`img[src*="${RUNE_IMAGE_PATH}"]`).first().attr("src");
  if (!name || !rawImage) return null;
  const image = new URL(rawImage, sourceUrl).href;
  const badges = cardBadges($, card);
  const lines = effectText($, card);
  const text = cleanText($(card).find("div.text-sm.text-slate-600.font-medium.leading-relaxed span.line-clamp-2").first().text());
  const path = badges[0] ?? null;
  const isKeystone = badges.some((badge) => badge.toLowerCase() === "keystone");
  const slug = runeSlug(image);
  return {
    slug,
    slugSource: "icon-filename",
    name,
    path,
    category: isKeystone ? "Keystone" : "Minor",
    image,
    description: lines[0] ?? text,
    values: valueLines(lines),
    effectText: text,
  };
}

/** Parse the Hub Game rune catalog as a current snapshot; this page does not publish per-rune history routes. */
export function parseHubGameRuneCatalog(html, sourceUrl) {
  if (typeof html !== "string" || html.trim().length < 100) {
    throw new TypeError("html must contain the rendered Hub Game rune catalog");
  }
  validateSourceUrl(sourceUrl);
  const $ = load(html);
  if (cleanText($("h1").first().text()) !== "Runes List") {
    throw new Error("Hub Game rune catalog page heading was not found");
  }
  const snapshot = snapshotMetadata($);
  const runes = $("div.group").toArray()
    .filter((element) => $(element).find("h3").length && $(element).find(`img[src*="${RUNE_IMAGE_PATH}"]`).length)
    .map((element) => parseRuneCard($, element, sourceUrl))
    .filter(Boolean);
  if (runes.length !== snapshot.count) {
    throw new Error(`Hub Game rune count mismatch: metadata says ${snapshot.count}, parsed ${runes.length}`);
  }
  const slugs = new Set();
  const names = new Set();
  for (const rune of runes) {
    if (!rune.slug || slugs.has(rune.slug) || !rune.name || names.has(rune.name) || !rune.path || !rune.effectText) {
      throw new Error("Hub Game rune catalog contains a missing or duplicate rune field");
    }
    slugs.add(rune.slug);
    names.add(rune.name);
  }
  return {
    source: {
      kind: SOURCE_KIND,
      url: sourceUrl,
      locale: "en",
      snapshot: {
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        translatedFromJapanese: snapshot.translatedFromJapanese,
      },
    },
    count: runes.length,
    runes,
  };
}
