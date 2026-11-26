import { load } from "cheerio";

const SOURCE_KIND = "hub-game-item-catalog";
const ITEM_IMAGE_PATH = "/images/items/";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceMetadata(pageText) {
  const release = pageText.match(/through\s+patch\s+([\w.]+)\s+\(updated\s+(\d{4}-\d{2}-\d{2})\)/i);
  const counts = pageText.match(/(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+items/i);
  if (!release || !counts) {
    throw new Error("Hub Game item catalog is missing version, date, or item count metadata");
  }

  const count = Number(counts[1].replaceAll(",", ""));
  const declaredCount = Number(counts[2].replaceAll(",", ""));
  if (!Number.isInteger(count) || count < 1 || count !== declaredCount) {
    throw new Error("Hub Game item catalog has an invalid displayed item count");
  }

  return { version: release[1], date: release[2], count };
}

function validateSourceUrl(sourceUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new TypeError("sourceUrl must be a valid URL");
  }
  if (parsedUrl.protocol !== "https:" || !["hub-game.com", "www.hub-game.com"].includes(parsedUrl.hostname)) {
    throw new TypeError("sourceUrl must use the HTTPS Hub Game domain");
  }
}

function itemSlug(name) {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’‘ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cardName(heading) {
  return cleanText(heading.find("[title]").first().attr("title") || heading.text());
}

function cardCost(card, $) {
  const costText = card.find("span").toArray()
    .map((span) => cleanText($(span).text()))
    .find((text) => /^[\d,]+\s*G$/i.test(text));
  return costText ? Number(costText.replace(/\s*G$/i, "").replaceAll(",", "")) : null;
}

function isStatLine(text) {
  return /^[+−-]?\s*\d/.test(text)
    && !/^[\d,]+\s*G$/i.test(text)
    && !/\bmore\s+stats\b/i.test(text);
}

function cardStats(card, $) {
  const stats = [];
  card.children("div").each((_, section) => {
    const directRows = $(section).children("div");
    directRows.each((__, row) => {
      const text = cleanText($(row).clone().find('[aria-hidden="true"]').remove().end().text());
      if (isStatLine(text)) stats.push(text);
    });
  });
  return [...new Set(stats)];
}

function isEffectHeading(element) {
  return ["Passive", "Active"].includes(cleanText(element.text()));
}

function effectDetails(effectNode, type) {
  const details = [];
  let current = effectNode;
  while (current.length) {
    current = current.next();
    if (!current.length || isEffectHeading(current)) break;
    if (!current.is("span.block")) continue;
    const parts = current.children("span");
    const name = cleanText(parts.first().text());
    const description = cleanText(parts.slice(1).text());
    if (name && description) details.push({ type, name, description });
  }
  return details;
}

function cardPassives(card, $) {
  const passives = [];
  card.find("span").each((_, element) => {
    const heading = $(element);
    const type = cleanText(heading.text());
    if (["Passive", "Active"].includes(type)) {
      passives.push(...effectDetails(heading, type));
    }
  });
  return passives;
}

function cardImage(card, sourceUrl, $) {
  const imagePath = card.find("img[src]").toArray()
    .map((image) => $(image).attr("src"))
    .find((src) => src?.includes(ITEM_IMAGE_PATH));
  if (!imagePath) return null;
  return new URL(imagePath, sourceUrl).href;
}

function parseItemCards($, sourceUrl) {
  const items = [];
  $("h3").each((_, element) => {
    const heading = $(element);
    const card = heading.parent();
    if (!card.find(`img[src*="${ITEM_IMAGE_PATH}"]`).length) return;
    const name = cardName(heading);
    const slug = itemSlug(name);
    items.push({
      slug,
      name,
      image: cardImage(card, sourceUrl, $),
      cost: cardCost(card, $),
      stats: cardStats(card, $),
      passives: cardPassives(card, $),
    });
  });
  return items;
}

function validateItems(items, expectedCount) {
  if (items.length !== expectedCount) {
    throw new Error(`Hub Game item count mismatch: metadata says ${expectedCount}, parsed ${items.length}`);
  }
  const slugs = new Set();
  for (const item of items) {
    if (!item.name || !item.slug || slugs.has(item.slug)) {
      throw new Error("Hub Game item catalog contains a missing or duplicate item name");
    }
    if (item.cost === null || !Number.isFinite(item.cost) || !item.image) {
      throw new Error(`Hub Game item card is missing cost or image: ${item.name}`);
    }
    slugs.add(item.slug);
  }
}

/** Parse Hub Game's SSR item catalog as the current primary item-list source. */
export function parseHubGameItemCatalog(html, sourceUrl) {
  if (typeof html !== "string" || html.trim().length < 100) {
    throw new TypeError("html must contain the rendered Hub Game item catalog");
  }
  validateSourceUrl(sourceUrl);

  const $ = load(html);
  if (cleanText($("h1").first().text()) !== "Items List") {
    throw new Error("Hub Game item catalog page heading was not found");
  }
  const metadata = sourceMetadata(cleanText($("body").text()));
  const items = parseItemCards($, sourceUrl);
  validateItems(items, metadata.count);

  return {
    sourceKind: SOURCE_KIND,
    sourceUrl,
    version: metadata.version,
    date: metadata.date,
    count: items.length,
    items,
  };
}
