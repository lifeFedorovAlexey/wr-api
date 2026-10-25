import { load } from "cheerio";

const SOURCE_KIND = "hub-game";
const ITEM_PATH = "/wildrift/images/items/";
const HISTORY_HEADING = / patch history$/i;

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
  const match = url.pathname.match(/^\/wildrift\/(en|ru-ru)\/items\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
  if (!match) throw new TypeError("sourceUrl must identify a Hub Game item detail page");
  return { locale: match[1].toLowerCase(), slug: match[2].toLowerCase() };
}

function sectionForHeading($, heading) {
  return $(heading).closest("section");
}

function itemName($) {
  const title = cleanText($("h1").first().text());
  const name = title.replace(/\s+[—–-]\s+Effect,\s*Stats\s*and\s*Cost$/i, "").trim();
  if (!name || name === title) throw new Error("Hub Game item detail heading was not recognized");
  return name;
}

function itemImage($, sourceUrl, name) {
  const image = $("img[alt]").toArray().find((element) => {
    const alt = cleanText($(element).attr("alt"));
    return alt === name && $(element).attr("src")?.includes(ITEM_PATH);
  });
  if (!image) return null;
  return new URL($(image).attr("src"), sourceUrl).href;
}

function itemCost($) {
  const candidate = $("p").toArray().map((element) => cleanText($(element).text()))
    .find((text) => /^Cost\s+[\d,]+\s*G$/i.test(text));
  if (!candidate) return null;
  const amount = candidate.match(/[\d,]+/)[0];
  const cost = Number(amount.replaceAll(",", ""));
  return Number.isSafeInteger(cost) ? cost : null;
}

function sourceSnapshot($) {
  const bodyText = cleanText($("body").text());
  const version = bodyText.match(/official patch note changes applied through patch\s+([\w.]+)/i)?.[1] ?? null;
  const updatedAt = bodyText.match(/\(updated\s+(\d{4}-\d{2}-\d{2})\)/i)?.[1] ?? null;
  const pageStatement = bodyText.match(/Effects and values:\s*([^\n]+?)(?:Pick counts and win rates:|Stats)/i)?.[1];
  return {
    version,
    updatedAt,
    basis: pageStatement ? cleanText(pageStatement) : null,
  };
}

function removalInfo($) {
  const bodyText = cleanText($("body").text());
  const patch = bodyText.match(/This item was removed from the game in patch\s+([a-z0-9]+(?:\.[a-z0-9]+)*)/i)?.[1] ?? null;
  return patch ? { availability: "removed", removedInPatch: patch } : { availability: "available", removedInPatch: null };
}

function parseStats($) {
  const heading = $("h2").toArray().find((element) => cleanText($(element).text()) === "Stats");
  if (!heading) return [];
  const section = sectionForHeading($, heading);
  return section.find("ul").first().children("li").toArray()
    .map((element) => cleanText($(element).clone().find('[aria-hidden="true"]').remove().end().text()))
    .filter(Boolean);
}

function classifyEffect($, name, description, container) {
  const declaredType = cleanText($(container).attr("data-effect-type") || $(container).find("[data-effect-type]").first().attr("data-effect-type"));
  if (/^(passive|active)$/i.test(declaredType)) return declaredType.toLowerCase();
  const prefix = `${name} ${description}`.match(/(?:^|\b)(passive|active)\s*:/i)?.[1];
  return prefix ? prefix.toLowerCase() : null;
}

function parseEffects($) {
  const heading = $("h2").toArray().find((element) => cleanText($(element).text()) === "Item Effects");
  if (!heading) return [];
  return sectionForHeading($, heading).find("dl > div").toArray().flatMap((container) => {
    const name = cleanText($(container).children("dt").text());
    const description = cleanText($(container).children("dd").text());
    if (!name || !description) return [];
    return [{ name, description, type: classifyEffect($, name, description, container) }];
  });
}

function parseHistory($, name) {
  const heading = $("h2").toArray().find((element) => HISTORY_HEADING.test(cleanText($(element).text())));
  if (!heading) return [];
  return sectionForHeading($, heading).find("article").toArray().flatMap((article) => {
    const articleName = cleanText($(article).find("h3").first().text());
    if (articleName !== name) return [];
    const patch = cleanText($(article).find('a[href*="/patches"]').first().text()).match(/Patch\s+([\w.]+)/i)?.[1];
    if (!patch) return [];
    const category = cleanText($(article).find("span").toArray().map((span) => cleanText($(span).text()))
      .find((text) => ["Buff", "Nerf", "Adjustment", "New", "Removed"].includes(text)));
    const changes = [];
    let group = null;
    $(article).find("h4, ul li").each((_, element) => {
      if ($(element).is("h4")) {
        group = cleanText($(element).text()) || null;
        return;
      }
      const label = cleanText($(element).find("span.block.font-bold").first().text());
      const values = $(element).find("span.block.tabular-nums").first();
      const before = cleanText(values.find("span.line-through").first().text());
      const after = cleanText(values.find("span.font-bold").last().text());
      if (label && before && after) changes.push({ group, label, before, after });
    });
    if (!changes.length) return [];
    return [{ patch, category: category || null, changes }];
  });
}

/** Parse one Hub Game item detail page; its stats are a current snapshot and its history may be incomplete. */
export function parseHubGameItemDetail(html, sourceUrl) {
  if (typeof html !== "string" || html.trim().length < 100) {
    throw new TypeError("html must contain the rendered Hub Game item detail page");
  }
  const identity = validateSourceUrl(sourceUrl);
  const $ = load(html);
  const canonicalUrl = $("link[rel='canonical']").attr("href") || $("meta[property='og:url']").attr("content");
  if (canonicalUrl) {
    const canonical = new URL(canonicalUrl, sourceUrl);
    const requested = new URL(sourceUrl);
    if (canonical.hostname !== requested.hostname || canonical.pathname.replace(/\/$/, "") !== requested.pathname.replace(/\/$/, "")) {
      throw new Error("Hub Game item detail canonical URL does not match the requested item identity");
    }
  }
  const name = itemName($);
  const image = itemImage($, sourceUrl, name);
  const cost = itemCost($);
  if (!image || cost === null) throw new Error(`Hub Game item detail is missing image or cost: ${identity.slug}`);

  const effects = parseEffects($);
  const snapshot = sourceSnapshot($);
  const status = removalInfo($);
  return {
    source: {
      kind: SOURCE_KIND,
      url: sourceUrl,
      locale: identity.locale,
      snapshot,
    },
    slug: identity.slug,
    name,
    ...status,
    image,
    cost,
    stats: parseStats($),
    effects,
    passives: effects.filter((effect) => effect.type === "passive"),
    actives: effects.filter((effect) => effect.type === "active"),
    history: parseHistory($, name),
    historyCoverage: "partial-or-absent",
  };
}
