import { load } from "cheerio";
import { classifyThresholdChange, compareNumericChangeDirection } from "./patchValueDirections.mjs";
import sanitizeHtml from "sanitize-html";
import { getPatchEffectiveDateMetadata } from "./patchEffectiveDates.mjs";
import {
  PATCH_NOTE_HISTORICAL_ITEM_IDENTITIES,
  PATCH_NOTE_HISTORICAL_RUNE_IDENTITIES,
} from "./patchNoteHistoricalIdentities.mjs";
import { normalizePatchChangeEntityClassification } from "./patchNoteEntityClassification.mjs";
import {
  findQualifiedItemVariantMentions,
  resolveQualifiedItemVariant,
  resolveQualifiedItemVariantBySlug,
} from "./patchItemVariantIdentity.mjs";

export const PATCH_NOTES_PARSER_VERSION = 132;

const RIOT_ORIGIN = "https://wildrift.leagueoflegends.com";
const PATCH_TAG = "patch_notes";
const ALLOWED_TAGS = new Set([
  "a", "b", "blockquote", "br", "caption", "dd", "div", "dl", "dt", "em",
  "h2", "h3", "h4", "h5", "hr", "i", "img", "li", "ol", "p", "small",
  "span", "strong", "sub", "sup", "table", "tbody", "td", "th", "thead",
  "tr", "u", "ul",
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resolveHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, RIOT_ORIGIN);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeEntityName(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToText(value) {
  return cleanText(load(String(value || "")).text());
}

function cleanSkinTitle(value) {
  return cleanText(value)
    .replace(/^[–—-]\s*/, "")
    .replace(/^\s*!?\s*на этот раз\s*[–—-]\s*/i, "")
    .replace(/^(?:the )?new skin\s+/i, "")
    .replace(/^the season-exclusive skin\s+/i, "");
}

const SKIN_RELEASE_CAPTION_PATTERN = /(?:\b(?:actually\s+)?(?:releasing|released(?!\s+if\b)|will\s+(?:be\s+)?(?:available|released)|arrives?|appears?\s+in\s+(?:the\s+)?game|becomes?\s+available)\b|(?:появится|появятся|выйдет|выйдут|доступен|доступна|доступны|станет\s+доступен|станет\s+доступна|будет\s+доступен|будет\s+доступна)\s+в\s+(?:игре|(?:патче|обновлении)\s+\d+\.\d+[a-zа-я]*)|доступ(?:ен|на|ны)\s+в\s+(?:патче|обновлении))/i;

function stripSkinReleaseCaption(value) {
  const source = cleanText(value);
  const match = SKIN_RELEASE_CAPTION_PATTERN.exec(source);
  return match ? cleanText(source.slice(0, match.index)) : source;
}

function resolveRiotUrl(value, locale) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, RIOT_ORIGIN);
    if (url.protocol !== "https:" || url.hostname !== "wildrift.leagueoflegends.com") return null;
    if (!url.pathname.startsWith(`/${locale}/news/`)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function extractPatchVersion(title, url = "") {
  const titleMatch = String(title || "").match(/(?:^|[^\p{L}\p{N}])(?:patch(?:\s+notes)?|описание\s+обновления|патч(?:-ноты|а)?)\s*(\d+)\s*[.\- ]\s*(\d+)([a-z]+)?\b/iu);
  if (titleMatch) return `${titleMatch[1]}.${titleMatch[2]}${titleMatch[3] || ""}`.toLowerCase();

  let pathname = String(url);
  try { pathname = new URL(String(url), RIOT_ORIGIN).pathname; }
  catch { /* Preserve path-only inputs supplied by callers and fixtures. */ }
  const pathMatch = pathname.match(/patch-(?:notes-)?(\d+)-?(\d+)([a-z]+)?(?=-|\/|$)/i)
    || pathname.match(/opisanie-obnovleniya-(\d+)-?(\d+)([a-z]+)?(?=-|\/|$)/i)
    || pathname.match(/patch-(?:notes-)?(\d)(\d)([a-z]+)?(?=-|\/|$)/i)
    || pathname.match(/opisanie-obnovleniya-(\d)(\d)([a-z]+)?(?=-|\/|$)/i);
  if (pathMatch) return `${pathMatch[1]}.${pathMatch[2]}${pathMatch[3] || ""}`.toLowerCase();
  return null;
}

function readNextData(html) {
  const $ = load(html);
  const data = $("#__NEXT_DATA__").text();
  if (!data) throw new Error("Riot page is missing __NEXT_DATA__");
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error("Riot __NEXT_DATA__ is not valid JSON");
  }
  const page = parsed?.props?.pageProps?.page;
  if (!page || !Array.isArray(page.blades)) throw new Error("Riot page has no blade data");
  return page;
}

export function extractPatchArticleMetadata(html) {
  const page = readNextData(html);
  const masthead = page.blades.find((blade) => blade?.type === "articleMasthead");
  return {
    url: String(page.url || ""),
    title: cleanText(masthead?.title || page.title),
  };
}

function isPatchNotesTag(tag) {
  return Boolean(tag && tag.machineName === PATCH_TAG);
}

function getPatchVersionForCard(title, url) {
  return url && title ? extractPatchVersion(title, url) : null;
}

function isPatchNoteCard(tags, title, url) {
  return tags.some(isPatchNotesTag)
    || (/(?:wild\s+rift\s+)?patch\s+notes|описание\s+обновления/i.test(title)
      && /\/news\/game-updates\/wild-rift-patch-notes-/i.test(url || ""));
}

function parsePatchCard(card, locale) {
  const {
    tags: rawTags,
    action: rawAction,
    title: rawTitle,
    publishedAt,
    analytics,
    imageMedia,
    media,
    description,
  } = card || {};
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const action = rawAction || {};
  const payload = action.payload || {};
  const url = resolveRiotUrl(payload.url || action.url, locale);
  const title = cleanText(rawTitle);
  if (!isPatchNoteCard(tags, title, url)) return null;
  const version = getPatchVersionForCard(title, url);
  if (!version) return null;
  const image = imageMedia || media || {};
  const imageUrl = typeof image.url === "string" ? image.url : null;
  const cardDescription = description || {};
  return {
    version,
    title,
    url,
    publishedAt: publishedAt || analytics?.publishDate || null,
    imageUrl,
    description: htmlToText(cardDescription.body || ""),
  };
}

export function parsePatchIndex(html, locale) {
  const page = readNextData(html);
  const grids = page.blades.filter((blade) => blade?.type === "articleCardGrid");
  if (!grids.length) throw new Error("Riot patch index has no articleCardGrid");
  const items = grids.flatMap((grid) => (Array.isArray(grid.items) ? grid.items : []))
    .map((card) => parsePatchCard(card, locale))
    .filter(Boolean);
  if (!items.length) throw new Error("Riot patch index returned no valid patch-note cards");
  const unique = new Map();
  for (const item of items) {
    if (!unique.has(item.version)) unique.set(item.version, item);
  }
  if (!unique.size) throw new Error("Riot patch index returned no valid patch-note cards");
  return Array.from(unique.values());
}

function sanitizeRichText(html) {
  const source = String(html || "").replace(/<\/?meta\b[^>]*>/gi, "");
  return sanitizeHtml(source, {
    allowedTags: Array.from(ALLOWED_TAGS),
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "loading"],
    },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    nonTextTags: ["style", "script", "textarea", "option", "xmp", "iframe", "object", "embed", "form", "video", "audio", "svg"],
    transformTags: {
      a: (_tagName, attributes) => {
        const href = resolveHttpsUrl(attributes.href);
        return {
          tagName: "a",
          attribs: {
            ...(href ? { href } : {}),
            target: "_blank",
            rel: "noopener noreferrer",
          },
        };
      },
      img: (_tagName, attributes) => {
        const imageUrl = resolveHttpsUrl(attributes.src);
        const src = imageUrl && new URL(imageUrl).hostname === "cmsassets.rgpub.io" ? imageUrl : null;
        return {
          tagName: "img",
          attribs: {
            ...(src ? { src } : {}),
            alt: cleanText(attributes.alt || ""),
            loading: "lazy",
          },
        };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
}

function extractRichText(blade) {
  return blade?.richText?.body || blade?.body || blade?.html || "";
}

function parseArticleBlade(blade) {
  if (blade?.type === "articleRichText" || blade?.type === "patchNotesRichText") {
    const html = sanitizeRichText(extractRichText(blade));
    const text = htmlToText(html);
    if (!text && !html.includes("<img")) return [];
    return [{
      kind: "content",
      heading: cleanText(blade.fragmentId || ""),
      summary: text.slice(0, 260),
      html,
    }];
  }
  if (blade?.type === "characterChanges") return parseCharacterChanges(blade);
  if (blade?.type === "articleRichTextAccordion") {
    return (Array.isArray(blade.groups) ? blade.groups : [])
      .filter((group) => group?.content?.body)
      .map((group) => ({
        kind: "content",
        heading: cleanText(group.label || ""),
        ...buildContentSection(group.label, group.content.body),
      }));
  }
  return [];
}

function nodeTextWithBreaks($, node) {
  const copy = $(node).clone();
  copy.find("br").replaceWith(". ");
  return cleanText(copy.text());
}

function extractStatChanges(html) {
  const $ = load(`<div>${String(html || "")}</div>`, null, false);
  return $.root().children().first().find("li,p").toArray()
    .filter((node) => {
      const tag = String(node.tagName || "").toLowerCase();
      const element = $(node);
      return !(tag === "p" && element.parents("li").length);
    })
    .map((node) => String(node.tagName || "").toLowerCase() === "li"
      ? directListItemText(node, $)
      : nodeTextWithBreaks($, node))
    .filter(Boolean)
    .map(parseChangeLine);
}

function parseChangeLine(rawText) {
  const text = cleanText(rawText);
  const split = text.replace(/：/g, ":").match(/^([^:]{1,240}):\s*(.*?)\s*(?:→|->)\s*(.*?)$/);
  if (split) return {
    label: cleanText(split[1]),
    before: cleanText(split[2]),
    after: cleanText(split[3]),
    text,
  };
  const arrowIndex = text.search(/(?:→|->)/);
  if (arrowIndex < 0) return { label: null, before: null, after: null, text };
  const beforeText = text.slice(0, arrowIndex);
  const afterText = text.slice(arrowIndex).replace(/^(?:→|->)\s*/, "");
  const compactStat = cleanText(beforeText).match(/^(.+?)\s+([+\-−]?\d[\d.,/%+\-−]*(?:\s*(?:ms|s|sec(?:onds?)?|секунд(?:ы|а)?))?)$/iu);
  return {
    label: compactStat ? cleanText(compactStat[1]) : null,
    before: cleanText(compactStat?.[2] || beforeText),
    after: cleanText(afterText),
    text,
  };
}

function directListItemText(node, $) {
  const copy = $(node).clone();
  copy.children("ul, ol").remove();
  copy.find("br").replaceWith(". ");
  return cleanText(copy.text());
}

function patchArticleNodeText(node, $) {
  return String(node?.tagName || "").toLowerCase() === "li"
    ? directListItemText(node, $)
    : nodeTextWithBreaks($, node);
}

function parseRichTextDetail(rawText) {
  const text = cleanText(rawText).replace(/：/g, ":")
    .replace(/(?<=[\d%])(?=[\p{Lu}][\p{L}\d\s]{1,60}:\s*[^:]*?(?:→|->))/gu, ". ");
  const changeParts = text.split(/(?<=[.!?;])\s+(?=[\p{Lu}][^:]{1,100}:\s*[^:]*?(?:→|->))/gu);
  if (changeParts.length > 1) {
    const changes = changeParts.map(parseChangeLine);
    if (changes.every(({ before, after }) => before && after)) return changes;
  }

  const parsed = parseChangeLine(rawText);
  if (parsed.before && parsed.after) return [parsed];

  const fields = parsed.text.split(/\s*;\s*/).filter(Boolean);
  if (fields.length > 1) {
    const rows = fields.map((field) => {
      const match = field.match(/^([^:]{1,60}):\s*(.+)$/)
        || field.match(/^(.{1,60}?)\s+(?=[+\-−]?\d)(.+)$/);
      if (!match) return null;
      const label = cleanText(match[1]);
      const value = cleanText(match[2]);
      return { label, before: null, after: null, text: value };
    });
    if (rows.every(Boolean)) return rows;
  }

  return [parsed];
}

function splitNamedStatHeading(value) {
  const match = cleanText(value).match(/^(.+?)\s+[–—-]\s*(?=(?:здоровье|сила атаки|броня|сопротивление магии)(?:\s|:|$))(.*)$/i);
  if (!match) return null;
  return { component: cleanText(match[1]), text: cleanText(match[2]) };
}

function nestedListComponents(node, $) {
  return $(node).parents("li").toArray().reverse()
    .map((parent) => directListItemText(parent, $))
    .filter((text) => text && text.length <= 90)
    .map((text) => text.replace(/:\s*$/, ""));
}

function isItemListComponentHeading(value) {
  const text = cleanText(value);
  return isItemComponentHeading(text) || (/:(?:\s*)$/u.test(text) && !/(?:→|->)/u.test(text));
}

function nestedItemListComponents(node, $) {
  return $(node).parents("li").toArray().reverse()
    .map((parent) => directListItemText(parent, $))
    .filter((text) => text && text.length <= 90 && isItemListComponentHeading(text))
    .map((text) => text.replace(/:\s*$/, ""));
}

function isChampionRotationHeading(value) {
  const text = cleanText(value);
  return /\bchampions?\b.{0,40}\brotations?\b|\brotations?\b.{0,40}\bchampions?\b|ротац\p{L}*.{0,40}чемпион\p{L}*|чемпион\p{L}*.{0,40}ротац\p{L}*/iu.test(text);
}

function getArticleChangeKind(sectionName) {
  if (isChampionRotationHeading(sectionName)) return null;
  const value = cleanText(sectionName).toLowerCase();
  if (/^yordle item updates$/i.test(value)) return "system";
  if (/\bskins?\b|скин|облик|образ/.test(value)) return "skin";
  if (/\b(?:summoner )?spells?\b|заклинан|призывающ(?:ие|их) заклинан|\bsmite\b|кар(?:а|ы|е|у)(?![а-яё])/.test(value)) return "spell";
  if (/\bitems?\b|предмет/.test(value)) return "item";
  if (/\bnew champions?\b|\bchampions? (?:added|introduced)\b|нов(?:ый|ые) чемпион/.test(value)) return "champion";
  if (/\bchampions?\b|чемпион/.test(value)) return "champion";
  if (/\bremoved champions?\b|\bdeleted champions?\b|удален\w* чемпион|убран\w* чемпион/.test(value)) return "champion";
  if (/\brunes?\b|рун/.test(value)) return "rune";
  if (/monster|battlefield|jungle|dragon|nexus|baron\s+nashor|turrets?|turret plating|game mode|gameplay|обитател|лес|дракон|нексус|барон\s+нашор|турел|башенн(?:ые|ых)? пластины|пол(?:е|я) боя|игровых? режим|игрового процесса/.test(value)) return "system";
  return null;
}

function isItemCollectionHeading(value) {
  const text = cleanText(stripEntityMarker(value));
  return /^(?:(?:tier\s+\d+|[\p{L}\p{N}'’&-]+)(?:\s+[\p{L}\p{N}'’&-]+){0,2}\s+items|items\s+(?:for|in|with)\s+[\p{L}\p{N}'’&-]+(?:\s+[\p{L}\p{N}'’&-]+){0,2}|boots?|предмет(?:ы|ов)(?:\s+[\p{L}\p{N}'’&-]+){0,3}|(?:предметы\s+\d+[-–]го\s+ранга\s*\([^)]*\)|заряженные\s+предметы)|ботинки)$/iu.test(text);
}

function isItemComponentHeading(value) {
  const text = getItemComponentLabel(value);
  return /^(?:(?:basic|core|base|additional|main) stats|base stats(?:\s+(?:основные|базовые) (?:параметры|показатели|характеристики))?|build path|recipe)$|^(?:основные|базовые|дополнительные) (?:параметры|показатели|характеристики)$|^(?:warmog's heart|сердце вармога|active|passive|active ability|passive ability|mana charge|ruined strikes|lifeline|shock|sunder|chase|resilience|lightshield strike|heavy artillery|bring it down|cauterize|defy|valor|fleetingness|artful strikes|block|dissolution|balance|magebane|noxian gait|blessed blade|big bully|purify(?:\s+очищение)?|annul|ever rising moon|stasis|giant slayer|снос|активное|пассивное|пассивно|активная способность|пассивная способность|путь сборки|рецепт|резервуар маны|линия жизни|губительные удары|шок|раскол|погоня|устойчивость|блокирование|прижигание|неповиновение|ледяной панцирь|ноксианская поступь|благословенный клинок|большой задира|удар лайтшилда|тяжелая артиллерия|очищение|аннулирование|вечная восходящая луна|восходящая луна|отвод|стазис|убийца великанов)$/i
    .test(text);
}

function getItemComponentLabel(value) {
  return cleanText(stripEntityMarker(value).replace(/:\s*$/, ""));
}

function isItemBuildPathComponent(value) {
  return /^(?:build path|recipe|путь сборки|рецепт)$/i.test(cleanText(value).replace(/:\s*$/, ""));
}

function getItemBuildPathTargets(text, catalog) {
  const label = normalizeEntityName(String(text || "").split(/[:：]/u, 1)[0]);
  const buildPath = /(?:^|\s)(?:build (?:path|patch)|recipe|путь сборки|рецепт)(?=\s|$)/u.exec(label);
  if (!buildPath) return null;

  const ownerText = label.slice(0, buildPath.index).trim();
  return findCatalogItemsInText(ownerText, catalog)
    .filter(({ entity }) => entity?.slug)
    .map((match) => ({ ...match, sourceText: text }));
}

function getParserFallbackItem(text, catalog) {
  const normalized = normalizeEntityName(stripItemHeadingDecorations(text));
  if (hasQualifiedItemAlias(text, catalog)) return null;
  const qualifiedVariant = resolveQualifiedItemVariant(text, catalog?.items);
  if (qualifiedVariant) return qualifiedVariant;
  const fallback = [
    { aliases: ["stormsurge", "штормовой прилив"], slug: "stormsurge", name: "Stormsurge" },
    { aliases: ["mikael's blessing", "mikael’s blessing", "благословение микаэля"], slug: "mikaels-blessing", name: "Mikael's Blessing" },
    { aliases: ["immortal treads", "бессмертные шаги"], slug: "immortal-treads", name: "Immortal Treads" },
    { aliases: ["crimson lucidity", "алое просветление"], slug: "crimson-lucidity", name: "Crimson Lucidity" },
    { aliases: ["lord dominik's regards", "lord dominik’s regards", "поклон лорда доминика"], slug: "lord-dominiks-regards", name: "Lord Dominik's Regards" },
    { aliases: ["the collector", "сборщик долгов"], slug: "the-collector", name: "The Collector" },
    ...PATCH_NOTE_HISTORICAL_ITEM_IDENTITIES.map(({ aliases, slug, name }) => ({ aliases, slug, name })),
  ];
  const entry = fallback.find((item) => item.aliases.some((alias) => {
    const normalizedAlias = normalizeEntityName(alias);
    return normalized === normalizedAlias || normalized.endsWith(normalizedAlias);
  }));
  if (!entry) return null;
  const existing = Array.from(catalog?.items?.values() || []).find((item) => item.slug === entry.slug || item.slug === entry.slug.replace(/s$/, ""));
  const isRussianAlias = /[а-яё]/i.test(text);
  return existing
    ? { ...existing, slug: entry.slug, name: entry.slug === "lord-dominiks-regards" || !isRussianAlias ? entry.name : existing.name }
    : { slug: entry.slug, name: entry.name };
}

function hasQualifiedItemAlias(value, catalog) {
  const qualified = cleanText(stripItemHeadingDecorations(value)).match(/^(.+?)\s+[-–—]\s+(.+)$/u);
  if (!qualified) return false;
  const baseAlias = normalizeEntityName(qualified[2]);
  return Boolean(catalog?.items?.has(baseAlias)
    || PATCH_NOTE_HISTORICAL_ITEM_IDENTITIES.some(({ aliases }) => aliases.some((alias) => normalizeEntityName(alias) === baseAlias)));
}

function findCatalogLead(kind, value, catalog) {
  const text = normalizeEntityName(stripEntityMarker(value));
  const map = kind === "item" ? catalog?.items : kind === "rune" ? catalog?.runes : kind === "spell" ? catalog?.spells : null;
  if (kind === "item") {
    const qualifiedVariant = resolveQualifiedItemVariant(value, map);
    if (qualifiedVariant) return { alias: text, entity: qualifiedVariant };
  }
  const aliases = Array.from(map?.keys() || []).sort((left, right) => right.length - left.length);
  const alias = aliases.find((candidate) => text === candidate || text.startsWith(`${candidate} `) || text.startsWith(`${candidate}:`));
  return alias ? { alias, entity: map.get(alias) } : null;
}

function isRuneTreeHeading(value) {
  return /^(?:domination|sorcery|resolve|precision|inspiration|доминирование|колдовство|храбрость|точность|вдохновение)$/i
    .test(cleanText(value));
}

function getEntityChangeHeadingKind(text) {
  return parseEntityChangeHeading(text)?.kind || null;
}

function parseEntityChangeHeading(text) {
  const prefix = /^(new|added|introduced|removed|deleted|нов[а-яё]*|добавлен[а-яё]*|удален[а-яё]*|удалён[а-яё]*)\s+(.+)$/i.exec(text);
  const suffix = /^(.+?)\s+(added|introduced|removed|deleted|добавлен[а-яё]*|удален[а-яё]*|удалён[а-яё]*)$/i.exec(text);
  const entityHeading = prefix || suffix;
  if (!entityHeading) return null;
  const candidate = cleanText(prefix ? entityHeading[2] : entityHeading[1]);
  if (!/^(?:(?:summoner\s+)?(?:champions?|items?|runes?|spells?|skins?)|(?:чемпион[а-яё]*|предмет[а-яё]*|рун[а-яё]*|заклинан[а-яё]*|облик[а-яё]*|образ[а-яё]*|призывающ(?:ие|их)\s+заклинан[а-яё]*))$/i.test(candidate)) return null;
  const kind = getArticleChangeKind(candidate);
  if (!["champion", "item", "rune", "spell", "skin"].includes(kind)) return null;
  const marker = /^(?:removed|deleted|удален|удалён)/i.test(prefix?.[1] || suffix?.[2] || "") ? "removed" : "new";
  return { kind, marker };
}

function getCategoryHeading(value) {
  const text = cleanText(value);
  if (/^yordle item updates$/i.test(text)) return "system";
  if (isItemCollectionHeading(text)) return "item";
  const entityChangeHeading = getEntityChangeHeadingKind(text);
  if (entityChangeHeading) return entityChangeHeading;
  if (/^(?:(?:major|minor|critical)\s+)?(?:bug\s*fix(?:es)?|error\s+fixes?|hotfix(?:es)?|known\s+issues)|^(?:(?:крупные|основные|прочие)\s+)?исправлен[а-яё]* ошибок|^(?:(?:крупные|основные|прочие)\s+)?исправлен[а-яё]* багов|^проблемы и исправления$/i.test(text)) return "system";
  if (/^(?:(?:other|additional)\s+)?champions?(?:\s+(?:base\s+)?stats?)?\s+(?:adjustments?|changes?|updates?)$|^(?:дополнительные\s+)?изменени[яе]\s+(?:базовых\s+)?(?:характеристик\s+)?чемпионов$/i.test(text)) return "champion";
  if (/^(?:baron\s+nashor|turrets?|systems?|game systems|system changes|system adjustments|gameplay systems|gameplay changes|other changes|other adjustments|battlefield system adjustments?|battlefield tempo(?: adjustments?)?|jungle changes?|jungle adjustments?|jungle economy adjustments?|other in-game adjustments?|(?:augment pool|augments?) adjustments?|training camp|custom mode|summoner(?:'|’)s rift|lifesteal|барон\s+нашор|турели|башни|другие изменения|прочие изменения|прочие правки|другие правки|системные изменения|системы?|игровые системы|изменения игрового процесса|изменения на поле боя|правила улучшения кары|изменения экономики леса|правила лесных монстров|изменения системы поля боя|кристаллическое разрастание|изменения, связанные с башнями|изменения темпа матча|миньоны|аура суперминьона|показатели миньонов|усиления зачистки миньонов|вампиризм|прочие внутриигровые изменения|внутриигровые рекомендации по ключевым предметам)$/i.test(text)) return "system";
  if (/^(?:(?:(?:[\p{L}\p{N}'’&-]+\s+){1,3})?items?\s+(?:updates?|adjustments?)|item adjustments for supports|изменени[яе] предметов для (?:игроков )?поддержки|изменения предметов поддержки|изменения предметов для стрелков)$/iu.test(text)) return "item";
  if (/^(?:active enchantment item changes?|boots?(?: and enchantments?)? adjustments?|(?:tier \d+ )?boots? purchase (?:regulations?|rules?)|mage item updates?|all tier \d+ mage items? adjustments?|изменения ботинок(?: и зачарований)?|изменения зачарований|все изменения предметов \d+[-–]го ранга для магов|правила покупки ботинок(?:\s+\d+[-–]го)?(?:\s+ранга)?)$/i.test(text)) return "item";
  if (/^(?:items?\s+(?:removed|deleted|returning)|(?:new|returning|re-?added|reintroduced|returned|removed|deleted)\s+items?|(?:удаленные|удалённые|возвращающиеся|новые|повторно добавленные) предметы)$/i.test(text)) return "item";
  if (/^(?:smite(?:\s+(?:adjustments?|changes?))?|(?:изменения\s+)?кар(?:а|ы)(?:\s+изменения)?|summoner spells?)$/i.test(text)) return "spell";
  if (/^(?:new|removed|deleted)\s+(?:champions?|items?|runes?|spells?)$|^(?:нов(?:ый|ая|ое|ые)|удал[её]н(?:ный|ная|ное|ные))\s+(?:чемпион(?:ы)?|предмет(?:ы)?|рун[аы]?|заклинани[ея])$/i.test(text)) {
    return getArticleChangeKind(text);
  }
  if (/^(?:(?:changes? to|item|champion|rune|summoner)\s+)?(?:items?|champions?|runes?|summoner spells?|skins?|spells?|предметы|чемпионы|руны|заклинания|облики|образы)$/i.test(text)) {
    return getArticleChangeKind(text);
  }
  if (/^(?:changes? to|изменения|изменение)\s+(?:items?|champions?|runes?|summoner spells?|spells?|предметов|чемпионов|рун|заклинаний)(?:\b|$)/i.test(text)) {
    return getArticleChangeKind(text);
  }
  if (/^(?:other|additional|прочие|другие)\s+(?:item|items|изменения предметов|предметы)/i.test(text)) return "item";
  if (/^(?:item|rune|champion|summoner spell)\s+(?:adjustments?|changes?|updates?)$/i.test(text)) return getArticleChangeKind(text);
  if (isBareSpellHeading(text)) return "spell";
  if (/^(?:(?:changes? to|изменения) )?(?:smite|кар(?:а|ы|е|у))(?: changes?)?$/i.test(text)) return "spell";
  if (/^(?:изменени(?:е|я) активных зачарований|изменения ботинок|предметы магов|изменения предметов поддержки|прочие предметы)$/i.test(text)) return "item";
  if (/^изменения чемпионов?[-–— ]/i.test(text)) return "champion";
  return null;
}

function getArticleHeadingCategoryKind(value) {
  const category = getCategoryHeading(value);
  if (category) return category;
  const heading = cleanText(value);
  const categoryTail = heading.match(/(?:^|[:：])\s*(champions?|items?|runes?|summoner\s+spells?|spells?|skins?)\s+(?:(?:base|basic)\s+)?(?:stats?|changes?|adjustments?|updates?)$/iu);
  if (categoryTail) return getArticleChangeKind(categoryTail[1]);
  const leadingCategory = heading.match(/^(champions?|items?|runes?|summoner\s+spells?|spells?|skins?)\s+(?:(?:base|basic)\s+)?(?:stats?|changes?|adjustments?|updates?)$/iu);
  return leadingCategory ? getArticleChangeKind(leadingCategory[1]) : null;
}

function isBareSpellHeading(value) {
  return /^(?:smite|кара|flash|вспышка|ignite|поджог|heal|исцеление|barrier|барьер|ghost|призрак|exhaust|изнурение|teleport|телепорт)$/i
    .test(cleanText(value));
}

function stripEntityMarker(value) {
  return cleanText(value)
    .replace(/^\s*(?:\[(?:new|added|introduced|removed|deleted|новое|добавлено|удалено|удалённо)\]|\((?:new|added|introduced|removed|deleted|новое|добавлено|удалено|удалённо)\))\s*/i, "")
    .replace(/\s*\[(?:new|новое|удалено|removed|deleted)\]\s*$/i, "")
    .replace(/\s*\((?:new|новое|удалено|removed|deleted)\)\s*$/i, "")
    .trim();
}

function getEntityMarker(value) {
  if (/\[(?:new|новое)\]|\((?:new|новое)\)/i.test(value)) return "new";
  if (/\[(?:removed|deleted|удалено)\]|\((?:removed|deleted|удалено)\)/i.test(value)) return "removed";
  return null;
}

function getCategoryMarker(value) {
  const text = cleanText(value);
  return getEntityMarker(value)
    || parseEntityChangeHeading(text)?.marker
    || (/^(?:new|added|introduced|нов[а-яё]*|добавлен[а-яё]*)(?:\s|$)/i.test(text) ? "new" : null)
    || (/^(?:returning|re-?added|reintroduced|returned|повторн[а-яё]*)(?:\s|$)/i.test(text) ? "returning" : null)
    || (/^(?:removed|deleted|items?\s+(?:removed|deleted)|удален[а-яё]*|удалён[а-яё]*)(?:\s|$)/i.test(text) ? "removed" : null)
    || (/^(?:champions?|items?|runes?|spells?|объект[а-яё]*|предмет[а-яё]*|чемпион[а-яё]*|рун[а-яё]*|заклинан[а-яё]*)\s+(?:added|introduced|добавлен[а-яё]*)$/i.test(text) ? "new" : null)
    || (/^(?:champions?|items?|runes?|spells?|объект[а-яё]*|предмет[а-яё]*|чемпион[а-яё]*|рун[а-яё]*|заклинан[а-яё]*)\s+(?:removed|deleted|удален[а-яё]*|удалён[а-яё]*)$/i.test(text) ? "removed" : null);
}

function isBootTierPurchaseRegulationHeading(value) {
  return /^(?:(?:(?:tier\s+\d+\s+)?boots?)\s+purchase\s+(?:regulations?|rules?)|правила покупки ботинок(?:\s+\d+[-–]го)?(?:\s+ранга)?)$/i
    .test(cleanText(value));
}

function getCatalogEntity(kind, value, catalog) {
  const normalizedName = normalizeEntityName(kind === "item" ? stripItemHeadingDecorations(value) : stripEntityMarker(value));
  const name = kind === "rune"
    ? normalizeEntityName(stripRuneCategoryPrefix(stripRuneEntityMarker(value)))
    : normalizedName;
  const entityMap = {
    champion: catalog?.champions,
    item: catalog?.items,
    rune: catalog?.runes,
    spell: catalog?.spells,
  }[kind];
  if (kind === "item") {
    const directEntity = entityMap?.get(normalizedName);
    const qualifiedVariant = resolveQualifiedItemVariant(value, entityMap);
    if (qualifiedVariant && (!directEntity || directEntity.slug === qualifiedVariant.baseItemSlug)) return qualifiedVariant;
    return getParserFallbackItem(value, catalog) || directEntity || null;
  }
  return (kind === "rune" ? entityMap?.get(normalizeEntityName(stripEntityMarker(value))) : null)
    || (kind === "rune" ? entityMap?.get(name) : null)
    || (kind === "rune" ? PATCH_RUNE_IDENTITIES.find((rune) => rune.aliases.some((alias) => normalizeEntityName(alias) === name)) : null)
    || entityMap?.get(name)
    || null;
}

function findCatalogChampionHeading(value, catalog) {
  const text = normalizeEntityName(stripEntityMarker(value));
  const entries = Array.from(catalog?.champions?.entries() || [])
    .sort(([left], [right]) => right.length - left.length);
  const match = entries.find(([alias]) => text === alias
    || text.startsWith(`${alias},`)
    || text.startsWith(`${alias} `));
  if (match) return { alias: match[0], entity: match[1] };

  const sourceCharacters = Array.from(text);
  if (sourceCharacters.length < 4) return null;
  const nearMatches = entries.filter(([alias]) => areNamesOneEditApart(text, alias));
  const uniqueEntities = new Map();
  for (const [alias, entity] of nearMatches) {
    uniqueEntities.set(entity.slug || entity.id || alias, { alias, entity });
  }
  return uniqueEntities.size === 1 ? uniqueEntities.values().next().value : null;
}

function areNamesOneEditApart(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (Math.abs(a.length - b.length) > 1) return false;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < a.length && rightIndex < b.length) {
    if (a[leftIndex] === b[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) leftIndex += 1;
    else if (b.length > a.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  if (leftIndex < a.length || rightIndex < b.length) edits += 1;
  return edits === 1;
}

function findCatalogMention(kind, value, catalog) {
  const text = normalizeEntityName(value);
  const map = kind === "item" ? catalog?.items : kind === "rune" ? catalog?.runes : kind === "spell" ? catalog?.spells : null;
  if (kind === "item") {
    const qualifiedVariant = resolveQualifiedItemVariant(value, map);
    if (qualifiedVariant) return { alias: text, entity: qualifiedVariant };
  }
  const aliases = Array.from(map?.keys() || [])
    .filter((alias) => alias.length >= (kind === "item" ? 5 : 3))
    .sort((left, right) => right.length - left.length);
  const alias = aliases.find((candidate) => text.includes(candidate));
  return alias ? { alias, entity: map.get(alias) } : null;
}

function findCatalogSpellMention(value, catalog) {
  const text = ` ${normalizeEntityName(stripEntityMarker(value))} `;
  const aliases = Array.from(catalog?.spells?.keys() || [])
    .map((alias) => [normalizeEntityName(alias), alias])
    .filter(([alias]) => alias.length >= 3)
    .sort(([left], [right]) => right.length - left.length);
  const match = aliases.find(([alias]) => text.includes(` ${alias} `));
  return match ? { alias: match[1], entity: catalog.spells.get(match[1]) } : null;
}

function getLocalizedCatalogAlias(value, alias) {
  if (!alias || !/[а-яё]/i.test(alias)) return null;
  const pattern = alias.split(" ").map((word) => Array.from(word, (character) => (
    character === "е" ? "[её]" : character === "и" ? "[ий]" : escapeRegex(character)
  )).join("")).join("[^\\p{L}\\p{N}]*");
  const match = String(value || "").match(new RegExp(pattern, "iu"));
  return match ? cleanText(match[0]) : null;
}

function getLocalizedChampionHeadingName(text, mention, champion, fallback, locale) {
  const sourceName = getLocalizedCatalogAlias(text, mention?.alias);
  const sourceIsRussian = /\p{Script=Cyrillic}/u.test(sourceName || "");
  const sourceMatchesLocale = sourceName && sourceIsRussian === (locale === "ru-ru");
  const localeKey = String(locale || "").replace(/-/g, "_").toLowerCase();
  const localizedName = cleanText(champion?.nameLocalizations?.[localeKey]);
  return formatHeadingDisplayName((sourceMatchesLocale ? sourceName : null) || localizedName || champion?.name || fallback, locale);
}

function getCatalogArticleName(value, kind, catalog, fallback, locale) {
  const runeSourceValue = kind === "rune" ? stripRuneEntityMarker(value) : value;
  const sourceValue = kind === "rune" ? stripRuneCategoryPrefix(runeSourceValue) : value;
  const categoryPrefixRemoved = kind === "rune"
    && normalizeEntityName(sourceValue) !== normalizeEntityName(runeSourceValue);
  const mention = findCatalogLead(kind, sourceValue, catalog)
    || (kind === "spell" ? findCatalogSpellMention(sourceValue, catalog) : findCatalogMention(kind, sourceValue, catalog));
  const entity = mention?.entity || getCatalogEntity(kind, sourceValue, catalog);
  return getLocalizedCatalogAlias(sourceValue, mention?.alias)
    || getRussianPatchEntityName(sourceValue, kind, locale, entity)
    || (entity?.itemVariant ? formatHeadingDisplayName(sourceValue, locale) : null)
    || (categoryPrefixRemoved ? entity?.name : null)
    || fallback;
}

function getCatalogSourceAlias(value, alias) {
  if (!alias) return null;
  const localized = getLocalizedCatalogAlias(value, alias);
  if (localized) return localized;
  const words = normalizeEntityName(alias).split(" ").filter(Boolean);
  if (!words.length) return null;
  const pattern = words.map(escapeRegex).join("[^\\p{L}\\p{N}]*");
  const match = String(value || "").match(new RegExp(pattern, "iu"));
  return match ? cleanText(match[0]) : null;
}

const VERIFIED_RUSSIAN_PATCH_ITEM_NAMES = [
  {
    englishName: "Dawnshroud",
    slug: "dawnshroud",
    russianName: "Утренний покров",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-0/",
  },
  {
    englishName: "Jaurim's Fist",
    slug: "jaurims-fist",
    russianName: "Кулак Чаурим",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-3-1b/",
  },
  {
    englishName: "Void Amethyst",
    slug: "void-amethyst",
    russianName: "Аметист Бездны",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-7-2/",
  },
  {
    englishName: "Shimmering Spark",
    slug: "shimmering-spark",
    russianName: "Мерцающая искра",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-1/",
  },
  {
    englishName: "Duskblade of Draktharr",
    slug: "duskblade-of-draktharr",
    russianName: "Сумеречный клинок Драктарра",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-3d/",
  },
  {
    englishName: "Magnetron Enchant",
    slug: "magnetron-enchant",
    russianName: "Зачарование магнита",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-3d/",
  },
  {
    englishName: "Repulsor Enchant",
    slug: "repulsor-enchant",
    russianName: "Зачарование репульсора",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-2h/",
  },
  {
    englishName: "Divine Sunderer",
    slug: "divine-sunderer",
    russianName: "Сокрушитель богов",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-0c/",
  },
  {
    englishName: "Gargoyle",
    slug: "gargoyle",
    russianName: "Гаргулья",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-0c/",
  },
  {
    englishName: "Solari Chargeblade",
    slug: "solari-chargeblade",
    russianName: "Заряженный клинок Солари",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-4c/",
  },
  {
    englishName: "Crystalline Reflector",
    slug: "crystalline-reflector",
    russianName: "Кристаллический отражатель",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-4b/",
  },
  {
    englishName: "Locket of the Iron Solari",
    slug: "locket-of-the-iron-solari",
    russianName: "Медальон Железных Солари",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-7-3b/",
  },
  {
    englishName: "Enchantment: Ravenous Hydra",
    slug: null,
    russianName: "Зачарование: Ненасытная гидра",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-2d/",
  },
  {
    englishName: "Blasting Wand",
    slug: "blasting-wand",
    russianName: "Разящий жезл",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-1/",
  },
  {
    englishName: "Hullbreaker",
    slug: "hullbreaker",
    russianName: "Бортолом",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-1/",
  },
  {
    englishName: "Black Cleaver",
    slug: "black-cleaver",
    russianName: "Черная секира",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-0/",
  },
  {
    englishName: "Black Mist Scythe",
    slug: "black-mist-scythe",
    russianName: "Коса черного тумана",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-3/",
  },
  {
    englishName: "Bulwark of the Mountain",
    slug: "bulwark-of-the-mountain",
    russianName: "Оплот горы",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-3/",
  },
  {
    englishName: "Hextech Soulstealer",
    slug: "hextech-soulstealer",
    russianName: "Хекстековый пожиратель душ",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-3/",
  },
  {
    englishName: "Talisman of Ascension",
    slug: "talisman-of-ascension",
    russianName: "Талисман вознесения",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-5-3/",
  },
  {
    englishName: "Gambler's Blade",
    slug: null,
    russianName: "Клинок картежника",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-0/",
  },
  {
    englishName: "Revival Enchant",
    slug: "revival-enchant",
    russianName: "Зачарование возрождения",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-0/",
  },
  {
    englishName: "Hextech GLP-800",
    slug: "hextech-glp-800",
    russianName: "Хекстековая НЛП 800",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-1/",
  },
  {
    englishName: "Mana Mune",
    slug: null,
    russianName: "Манамунэ",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-2c-1/",
  },
  {
    englishName: "Giant Slayer",
    slug: null,
    russianName: "Убийца великанов",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-2d/",
  },
  {
    englishName: "Perplexity",
    slug: null,
    russianName: "Замешательство",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-2d/",
  },
  {
    englishName: "Hexdrinker",
    slug: null,
    russianName: "Пожиратель заклятий",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-6-2e/",
  },
  {
    englishName: "Mejai's Soulstealer",
    slug: "mejais-soulstealer",
    russianName: "Пожиратель душ Меджай",
    sourceUrl: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-4-4a/",
  },
];

const RUSSIAN_PATCH_ENTITY_NAMES = new Map([
  ["spell:smite", "Кара"],
  ["spell:teleport", "Телепорт"],
  ["spell:barrier", "Барьер"],
  ["spell:heal", "Исцеление"],
  ["spell:cleanse", "Очищение"],
  ["spell:exhaust", "Изнурение"],
  ["system:turrets", "Башни"],
  ["system:jungle monsters", "Лесные монстры"],
  ["system:bug fixes", "Исправление ошибок"],
  ["system:guild leaderboard settlement rules optimization", "Оптимизация правил таблицы лидеров среди гильдий"],
  ["system:autumnal adventures rotating modes", "Осенние приключения: ротируемые режимы"],
  ["system:events", "События"],
  ["system:damage dealt", "Наносимый урон"],
  ["system:damage received", "Получаемый урон"],
  ["system:returning items", "Повторно добавленные предметы"],
  ["system:heal effect", "Эффект лечения"],
  ["system:sunburst", "Солнечный свет"],
  ["system:mirrored force", "Зеркальная сила"],
  ["system:autumnal adventures: rotating modes", "Осенние приключения: ротируемые режимы"],
  ["skin:legends showdown volibear chromas", "Цветовые схемы «Гроза легенд Волибир»"],
  ["skin:legends showdown volibear lpl", "Гроза легенд Волибир (LPL)"],
  ["skin:legends showdown volibear lck", "Гроза легенд Волибир (LCK)"],
  ["skin:legends showdown volibear lec", "Гроза легенд Волибир (LEC)"],
  ["skin:legends showdown volibear cblol", "Гроза легенд Волибир (CBLOL)"],
  ["skin:legends showdown volibear lcs", "Гроза легенд Волибир (LCS)"],
  ["skin:legends showdown volibear lcp", "Гроза легенд Волибир (LCP)"],
  ["skin:ashen knight pyke", "Пепельный рыцарь Пайк"],
  ["skin:stargazer jax", "Звездочет Джакс"],
  ["skin:star guardian akali", "Звездная защитница Акали"],
  ["skin:star guardian syndra", "Звездная защитница Синдра"],
  ["skin:prestige star guardian syndra", "Звездная защитница Синдра (престижное издание)"],
  ["item:solari chargeblade", "Заряженный клинок Солари"],
  ["item:gargoyle", "Гаргулья"],
  ["item:divine sunderer", "Сокрушитель богов"],
  ["item:crystalline reflector", "Кристаллический отражатель"],
  ["item:mirrored force", "Зеркальная сила"],
  ["item:sunburst", "Солнечный свет"],
  ["item:enchantment ravenous hydra", "Зачарование: Ненасытная гидра"],
  ["item:gambler s blade", "Клинок картежника"],
  ["item:gambler s blade new to this mode", "Клинок картежника"],
  ["item:tailsman of ascension", "Талисман вознесения"],
  ["item:revival enchant", "Зачарование возрождения"],
  ["item:mana mune", "Манамунэ"],
  ["item:heartsteel", "Сердце стали"],
  ["item:big bully", "Большой задира"],
  ["item:perplexity", "Замешательство"],
  ["item:giant slayer", "Убийца великанов"],
  ["item:hexdrinker", "Пожиратель заклятий"],
  ["item:veil", "Завеса"],
  ["rune:domination giant slayer", "Доминирование: Убийца великанов"],
  ["rune:keystone lethal tempo", "Ключевая руна: Смертельный темп"],
  ["rune:first strike", "Удар на опережение"],
  ["rune:lethal tempo", "Смертельный темп"],
  ["rune:inspiration hextech flashtraption", "Вдохновение: Хекстековый скачок"],
  ["rune:contraction hextech flashtraption", "Приспособление: Хекстековый скачок"],
  ["rune:contraption hextech flashtraption", "Приспособление: Хекстековый скачок"],
  ["rune:contraption item crafting", "Приспособление: Создание предметов"],
  ["rune:contraction item crafting", "Приспособление: Создание предметов"],
  ["rune:domination eyeball collection", "Доминирование: Коллекция глаз"],
  ["rune:domination zombie ward", "Доминирование: Тотем-зомби"],
  ["rune:domination empowered attack", "Доминирование: Усиленная атака"],
  ["rune:domination psychic wave", "Доминирование: Психическая волна"],
  ["rune:keystone empowerment", "Ключевая руна: Усиление"],
  ["rune:keystone arcane comet", "Ключевая руна: Магическая комета"],
  ["rune:arcane comet", "Магическая комета"],
  ["rune:empowerment", "Усиление"],
  ["rune:onslaught", "Храбрость: Бойня"],
  ["rune:overgrowth", "Храбрость: Разрастание"],
  ["rune:resolve overgrowth", "Храбрость: Разрастание"],
  ["rune:precision coup de grace", "Точность: Удар милосердия"],
  ["rune:inspiration sweet tooth", "Вдохновение: Сладкоежка"],
  ["rune:keystone fleet footwork", "Ключевая руна: Искусное лавирование"],
  ["rune:keystone aftershock", "Ключевая руна: Дрожь земли"],
  ["rune:inspiration ixtali seedjar", "Вдохновение: Банка для семян"],
  ["rune:brutal", "Жестокость"],
  ["rune:sudden impact", "Внезапный удар"],
  ["rune:transcendence", "Превосходство"],
  ["rune:inspiration hextech flashtraption", "Вдохновение: Хекстековый скачок"],
  ["rune:hextech flashtraption", "Хекстековый скачок"],
  ["rune:lethal tempo", "Смертельный темп"],
  ["rune:first strike", "Удар на опережение"],
  ["item:light horizon focus", "Свет — Хекстековый прицел"],
  ["item:light infinity orb", "Свет — Сфера бесконечности"],
  ["item:light harmonic echo", "Свет — Мелодичное эхо"],
  ["item:light riftmaker", "Свет — Творец разломов"],
  ["item:light youmuu s ghostblade", "Свет — Призрачный клинок Йомуу"],
  ["item:light dawnshroud", "Свет — Утренний покров"],
  ["item:ruin rabadon s deathcap", "Погибель — Смертельная шляпа Рабадона"],
  ["item:ruin blade of the ruined king", "Погибель — Клинок Падшего короля"],
  ["item:ruin infinity edge", "Погибель — Грань Бесконечности"],
  ["item:ruin amaranth s twinguard", "Погибель — Амарантовый доспех"],
  ["item:ruin warmog s armor", "Погибель — Доспех Вармога"],
  ["item:ruin sterak s gage", "Погибель — Испытание Стерака"],
  ["item:seeker s armguard", "Наручи Искательницы"],
  ["item:eclipse", "Затмение"],
  ["item:edge of night", "Грань ночи"],
  ["item:stormsurge", "Штормовой прилив"],
  ["item:manamune", "Манамунэ"],
  ["item:muramana", "Мурамана"],
  ["item:seraph s embrace", "Объятья серафима"],
  ["item:blade of the ruined king", "Клинок Падшего короля"],
  ["item:armorcrusher boots", "Ботинки крушителя брони"],
  ["item:chempunk chainsword", "Нож-пила химпанка"],
  ["item:harmonic echo", "Мелодичное эхо"],
  ["item:staff of flowing waters", "Посох водного потока"],
  ["item:ardent censer", "Пылающая кадильница"],
  ["item:nashor s tooth", "Зуб Нашора"],
  ["item:youmuu s ghostblade", "Призрачный клинок Йомуу"],
  ["item:locket enchant", "Медальон Железных Солари"],
  ["item:thornmail", "Шипованный доспех"],
  ["item:warmog s armor", "Доспех Вармога"],
  ["item:noonquiver", "Полуденный колчан"],
  ["item:the collector", "Сборщик долгов"],
  ["item:ravenous hydra", "Ненасытная гидра"],
  ["item:kirchei s shard", "Осколок Кирхайс"],
  ["item:kraken slayer", "Убийца кракенов"],
  ["item:magnetic blaster", "Магнитный бластер"],
  ["item:cloak of agility", "Плащ ловкости"],
  ["item:forbidden idol", "Запретный идол"],
  ["item:imperial mandate", "Имперский мандат"],
  ["item:yordle trap", "Ловушка йордлов"],
  ["item:cosmic drive", "Космический ускоритель"],
  ["item:trinity force", "Тройственный Союз"],
  ["item:stinger", "Жало"],
  ["item:protobelt enchant", "Хекстековый ракетный ремень"],
  ["item:stoneplate enchant", "Каменный доспех гаргульи"],
  ["item:ionian boots of lucidity", "Ионийские сапоги просветления"],
  ["item:amplifying tome", "Усиливающий фолиант"],
  ["item:fiendish codex", "Бесовской манускрипт"],
  ["item:needlessly large rod", "Слишком Большой Жезл"],
  ["item:lich bane", "Гроза Личей"],
  ["item:rylai s crystal scepter", "Хрустальный скипетр Рилай"],
  ["item:horizon focus", "Хекстековый прицел"],
  ["item:psychic projector", "Духовный проектор"],
  ["item:crown of the shattered queen", "Венец Расколотой королевы"],
  ["item:awakened soulstealer", "Пробужденный пожиратель душ"],
  ["item:ring of revelation", "Кольцо откровений"],
  ["item:kaenic rookern", "Кейниковый рукерн"],
  ["item:tear of the goddess", "Слеза богини"],
  ["item:knight s vow", "Клятва рыцаря"],
  ["item:overlord s bloodmail", "Кровавая кольчуга господина"],
  ["item:unending despair", "Бесконечное отчаяние"],
  ["item:experimental hexplate", "Экспериментальная хекстековая броня"],
  ["item:titanic hydra", "Титаническая гидра"],
  ["item:death s dance", "Танец смерти"],
  ["item:terminus", "Светотень"],
  ["item:navori quickblades", "Быстрые клинки Навори"],
  ["item:infinity edge", "Грань Бесконечности"],
  ["item:soul transfer", "Перенос души"],
  ["item:nashor s talon", "Коготь Нашора"],
  ["item:diadem of songs", "Диадема песен"],
  ["item:whispering circlet", "Шепчущая диадема"],
  ["item:echoes of helia", "Эхо Гелии"],
  ["rune:legend haste", "Легенда: ускорение"],
  ["rune:relentless hunter", "Беспощадный охотник"],
  ["rune:item crafting", "Создание предметов"],
  ["rune:future s market", "Рынок будущего"],
  ["rune:electrocute", "Казнь электричеством"],
  ["rune:cheap shot", "Грязный прием"],
  ["rune:grasp of the undying", "Хватка нежити"],
  ["rune:aery", "Пушинка"],
  ["item:runaans hurricane", "Ураган Рунаан"],
  ["item:spear of shojin", "Копье Седзина"],
]);
for (const { englishName, russianName } of VERIFIED_RUSSIAN_PATCH_ITEM_NAMES) {
  RUSSIAN_PATCH_ENTITY_NAMES.set(`item:${normalizeEntityName(englishName)}`, russianName);
}

const PATCH_RUNE_IDENTITIES = PATCH_NOTE_HISTORICAL_RUNE_IDENTITIES;

const RUSSIAN_PATCH_ENTITY_SLUG_NAMES = new Map([
  ["immortal-treads", "Бессмертные шаги (улучшение Алчных наголенников)"],
  ["crimson-lucidity", "Алое просветление (улучшение Ионийских сапог просветления)"],
  ["wits-end", "Смерть Разума"],
  ["redemption", "Искупление"],
  ["dagger", "Кинжал"],
  ["last-whisper", "Предсмертный шепот"],
  ["recurve-bow", "Изогнутый лук"],
  ["zeal", "Рвение"],
  ["vampiric-scepter", "Вампирский скипетр"],
  ["kircheis-shard", "Осколок Кирхайс"],
  ["stormrazor", "Грозовая бритва"],
  ["immortal-shieldbow", "Арбалет бессмертия"],
  ["bloodthirster", "Кровопийца"],
  ["guinsoos-rageblade", "Клинок ярости Гинсу"],
  ["phantom-dancer", "Призрачный Танцор"],
  ["mortal-reminder", "Глашатай смерти"],
  ["winged-moonplate", "Крылья луны"],
  ["bamis-cinder", "Пепел Бами"],
  ["aether-wisp", "Эфирный всполох"],
  ["phage", "Поглотитель"],
  ["zekes-convergence", "Конвергенция Зика"],
  ["abyssal-mask", "Маска пустоты"],
  ["winters-approach", "Вестник зимы"],
  ["amaranths-twinguard", "Амарантовый доспех"],
  ["dead-mans-plate", "Броня мертвеца"],
  ["stridebreaker", "Костолом"],
  ["goredrinker", "Потрошитель"],
  ["quicksilver-enchant", "Зачарование «Живое серебро»"],
  ["mercurial-scimitar", "Ртутный ятаган"],
  ["galeforce", "Сила шторма"],
  ["mikaels-blessing", "Благословение Микаэля"],
  ["glorious-enchant", "Зачарование славы"],
  ["veil-enchant", "Зачарование завесы"],
  ["dream-maker", "Сновичок"],
  ["boots-of-mana", "Ботинки маны"],
  ["mercurys-treads", "Поступь Меркурия"],
  ["berserkers-greaves", "Наголенники берсерка"],
  ["plated-steelcaps", "Бронированные сапоги"],
  ["gluttonous-greaves", "Алчные наголенники"],
  ["boots-of-dynamism", "Ботинки динамичности"],
  ["lost-chapter", "Потерянная глава"],
  ["hextech-alternator", "Хекстек-альтернатор"],
  ["haunting-guise", "Преследующая маска"],
  ["rod-of-ages", "Жезл веков"],
  ["infinity-orb", "Сфера бесконечности"],
  ["liandrys-torment", "Мучения Лиандри"],
  ["riftmaker", "Творец разломов"],
  ["archangels-staff", "Посох архангела"],
  ["rabadons-deathcap", "Смертельная шляпа Рабадона"],
  ["oceanids-trident", "Трезубец океаниды"],
  ["ludens-echo", "Эхо Людена"],
  ["malignance", "Пагубность"],
  ["morellonomicon", "Мореллономикон"],
  ["prophets-pendant", "Талисман пророка"],
  ["bandle-fantasy", "Бандловая фантазия"],
  ["harmonic-echo", "Мелодичное эхо"],
  ["ardent-censer", "Пылающая кадильница"],
  ["staff-of-flowing-waters", "Посох водного потока"],
  ["frozen-heart", "Ледяное сердце"],
  ["guardian-angel", "Ангел-хранитель"],
  ["steraks-gage", "Испытание Стерака"],
  ["maw-of-malmortius", "Зев Малмортиуса"],
  ["mantle-of-the-twelfth-hour", "Мантия двенадцатого часа"],
  ["force-of-nature", "Сила природы"],
  ["seryldas-grudge", "Злоба Серильды"],
  ["essence-reaver", "Похититель сущности"],
  ["sunfire-aegis", "Эгида солнечного пламени"],
  ["sapphire-crystal", "Сапфировый кристалл"],
  ["rapid-firecannon", "Скорострельная пушка"],
  ["fiendhunter-bolts", "Стрелы борца с демонами"],
  ["statikk-shiv", "Заточка Статикка"],
  ["nashors-tooth", "Зуб Нашора"],
  ["fimbulwinter", "Великанская зима"],
  ["dusk-and-dawn", "Закат и рассвет"],
  ["searing-crown", "Обжигающая корона"],
  ["surging-scales", "Вздымающаяся чешуя"],
  ["ingenious-hunter", "Изобретательный охотник"],
  ["yun-tal-wildarrows", "Дикие стрелы Юнталь"],
  ["eclipse", "Затмение"],
  ["edge-of-night", "Грань ночи"],
  ["stormsurge", "Штормовой прилив"],
  ["manamune", "Манамунэ"],
  ["muramana", "Мурамана"],
  ["seraphs-embrace", "Объятья серафима"],
  ["blade-of-the-ruined-king", "Клинок Падшего короля"],
  ["armorcrusher-boots", "Ботинки крушителя брони"],
  ["seekers-armguard", "Наручи Искательницы"],
  ["verdant-barrier", "Изумрудный оберег"],
  ["chempunk-chainsword", "Нож-пила химпанка"],
  ["runaans-hurricane", "Ураган Рунаан"],
  ["spear-of-shojin", "Копье Седзина"],
  ["youmuus-ghostblade", "Призрачный клинок Йомуу"],
  ["locket-enchant", "Медальон Железных Солари"],
  ["thornmail", "Шипованный доспех"],
  ["warmogs-armor", "Доспех Вармога"],
  ["noonquiver", "Полуденный колчан"],
  ["the-collector", "Сборщик долгов"],
  ["kraken-slayer", "Убийца кракенов"],
  ["magnetic-blaster", "Магнитный бластер"],
  ["cloak-of-agility", "Плащ ловкости"],
  ["forbidden-idol", "Запретный идол"],
  ["imperial-mandate", "Имперский мандат"],
  ["yordle-trap", "Ловушка йордлов"],
  ["cosmic-drive", "Космический ускоритель"],
  ["trinity-force", "Тройственный Союз"],
  ["stinger", "Жало"],
  ["protobelt-enchant", "Хекстековый ракетный ремень"],
  ["stoneplate-enchant", "Каменный доспех гаргульи"],
  ["ionian-boots-of-lucidity", "Ионийские сапоги просветления"],
  ["amplifying-tome", "Усиливающий фолиант"],
  ["fiendish-codex", "Бесовской манускрипт"],
  ["needlessly-large-rod", "Слишком Большой Жезл"],
  ["lich-bane", "Гроза Личей"],
  ["rylais-crystal-scepter", "Хрустальный скипетр Рилай"],
  ["horizon-focus", "Хекстековый прицел"],
  ["psychic-projector", "Духовный проектор"],
  ["crown-of-the-shattered-queen", "Венец Расколотой королевы"],
  ["awakened-soulstealer", "Пробужденный пожиратель душ"],
  ["ring-of-revelation", "Кольцо откровений"],
  ["kaenic-rookern", "Кейниковый рукерн"],
  ["tear-of-the-goddess", "Слеза богини"],
  ["knights-vow", "Клятва рыцаря"],
  ["overlords-bloodmail", "Кровавая кольчуга господина"],
  ["unending-despair", "Бесконечное отчаяние"],
  ["experimental-hexplate", "Экспериментальная хекстековая броня"],
  ["titanic-hydra", "Титаническая гидра"],
  ["deaths-dance", "Танец смерти"],
  ["terminus", "Светотень"],
  ["navori-quickblades", "Быстрые клинки Навори"],
  ["infinity-edge", "Грань Бесконечности"],
  ["soul-transfer", "Перенос души"],
  ["nashors-talon", "Коготь Нашора"],
  ["diadem-of-songs", "Диадема песен"],
  ["whispering-circlet", "Шепчущая диадема"],
  ["echoes-of-helia", "Эхо Гелии"],
  ["legend-haste", "Легенда: ускорение"],
  ["relentless-hunter", "Беспощадный охотник"],
  ["item-crafting", "Создание предметов"],
  ["futures-market", "Рынок будущего"],
  ["electrocute", "Казнь электричеством"],
  ["cheap-shot", "Грязный прием"],
  ["grasp-of-the-undying", "Хватка нежити"],
  ["aery", "Пушинка"],
]);

const RUSSIAN_PATCH_ENTITY_SLUG_NAMES_BY_KIND = new Map([
  ["spell:smite", "Кара"],
  ["spell:teleport", "Телепорт"],
  ["system:jungle-monsters", "Лесные монстры"],
  ["system:damage-dealt", "Наносимый урон"],
  ["system:damage-received", "Получаемый урон"],
  ["system:heal-effect", "Эффект лечения"],
  ["system:sunburst", "Солнечный свет"],
  ["system:mirrored-force", "Зеркальная сила"],
  ["rune:first-strike", "Удар на опережение"],
  ["rune:lethal-tempo", "Смертельный темп"],
  ["rune:giant-slayer", "Убийца великанов"],
  ["rune:hextech-flashtraption", "Хекстековый скачок"],
  ["rune:eyeball-collection", "Коллекция глаз"],
  ["rune:zombie-ward", "Тотем-зомби"],
  ["skin:volibear-legends-showdown-volibear-chromas", "Цветовые схемы «Гроза легенд Волибир»"],
  ["skin:volibear-legends-showdown-volibear-lpl", "Гроза легенд Волибир (LPL)"],
  ["skin:volibear-legends-showdown-volibear-lck", "Гроза легенд Волибир (LCK)"],
  ["skin:volibear-legends-showdown-volibear-lec", "Гроза легенд Волибир (LEC)"],
  ["skin:volibear-legends-showdown-volibear-cblol", "Гроза легенд Волибир (CBLOL)"],
  ["skin:volibear-legends-showdown-volibear-lcs", "Гроза легенд Волибир (LCS)"],
  ["skin:volibear-legends-showdown-volibear-lcp", "Гроза легенд Волибир (LCP)"],
  ["skin:volibear-гроза-легенд-волибир-lpl", "Гроза легенд Волибир (LPL)"],
  ["skin:volibear-гроза-легенд-волибир-lck", "Гроза легенд Волибир (LCK)"],
  ["skin:volibear-гроза-легенд-волибир-lec", "Гроза легенд Волибир (LEC)"],
  ["skin:volibear-гроза-легенд-волибир-cblol", "Гроза легенд Волибир (CBLOL)"],
  ["skin:volibear-гроза-легенд-волибир-lcs", "Гроза легенд Волибир (LCS)"],
  ["skin:volibear-гроза-легенд-волибир-lcp", "Гроза легенд Волибир (LCP)"],
  ["skin:pyke-ashen-knight-pyke", "Пепельный рыцарь Пайк"],
  ["skin:jax-stargazer-jax", "Звездочет Джакс"],
  ["skin:akali-star-guardian-akali", "Звездная защитница Акали"],
  ["skin:syndra-star-guardian-syndra", "Звездная защитница Синдра"],
  ["skin:syndra-prestige-star-guardian-syndra", "Звездная защитница Синдра (престижное издание)"],
  ["item:veil", "Завеса"],
  ["item:sundered-sky", "Расколотое небо"],
  ["item:randuins-omen", "Знамение Рандуина"],
  ["item:ancient-coin", "Древняя монета"],
  ["item:relic-shield", "Древний щит"],
  ["item:spectral-sickle", "Призрачный серп"],
]);

for (const { slug, russianName } of VERIFIED_RUSSIAN_PATCH_ITEM_NAMES) {
  if (slug) RUSSIAN_PATCH_ENTITY_SLUG_NAMES_BY_KIND.set(`item:${slug}`, russianName);
}

export function getRussianPatchEntityName(value, kind, locale, entity) {
  if (locale !== "ru-ru") return null;
  return RUSSIAN_PATCH_ENTITY_NAMES.get(`${kind}:${normalizeEntityName(stripEntityMarker(value))}`)
    || RUSSIAN_PATCH_ENTITY_SLUG_NAMES_BY_KIND.get(`${kind}:${entity?.slug}`)
    || RUSSIAN_PATCH_ENTITY_SLUG_NAMES.get(entity?.slug)
    || null;
}

export function isGameModeHeading(value) {
  return /^(?:aaa\s+aram|aram|арена|своя игра|отвязное безумие|аркадный режим|arena|adventure modes?|режимы? приключени\p{L}*|battlefest(?:\s+(?:season\s*)?s?\d+)?|unbound frenzy|sonic waves(?:\s+season theme)?|training camp|custom mode|приключенческий режим|all random ultra rapid fire(?:\s+mode)?(?:\s*\(arurf\))?|arurf|ultimate spellbook|книга заклинаний)$/iu.test(cleanText(value));
}

export function isGameModeChangesHeading(value) {
  return /^(?:game mode changes|game mode adjustments|mode changes|game modes?|gamemodes|игровые режимы|режимы игры|изменения игровых режимов|изменения режимов игры|изменения игрового режима)$/iu
    .test(cleanText(value));
}

function getGameModeChangesScope(value) {
  const title = cleanText(value).replace(/\s+(?:changes?|adjustments?|изменени[яе])$/iu, "");
  if (!title || title === cleanText(value)) return null;
  if (/^ultimate spellbook$/iu.test(title)) {
    return { type: "game-mode", modeSlugs: ["ultimate-spellbook"], modeNames: ["Ultimate Spellbook"] };
  }
  return getGameModeScope(title);
}

export function getGameModeScope(value) {
  const text = cleanText(value);
  const modes = [];
  const add = (slug, name) => {
    if (!modes.some((mode) => mode.slug === slug)) modes.push({ slug, name });
  };

  if (/^(?:[aа]{3}\s*арам(?:\s*[&+/]\s*арам)?|[aа]{3}\s*aram(?:\s*[&+/]\s*aram)?)$/iu.test(text)) {
    add("aaa-aram", /ааа/i.test(text) ? "ААА АРАМ" : "AAA ARAM");
    if (/[&+/]/.test(text)) add("aram", "ARAM");
  } else if (/^(?:aram|арам)$/i.test(text)) {
    add("aram", /арам/i.test(text) ? "ARAM" : "ARAM");
  } else if (/^(?:arena|арена)$/i.test(text)) {
    add("arena", /арена/i.test(text) ? "Арена" : "Arena");
  } else if (/^(?:all random ultra rapid fire(?:\s+mode)?(?:\s*\(arurf\))?|arurf)$/iu.test(text)) {
    add("arurf", "All Random Ultra Rapid Fire");
  } else if (/^(?:ultimate spellbook|книга заклинаний)$/iu.test(text)) {
    add("ultimate-spellbook", /книг/i.test(text) ? "Книга заклинаний" : "Ultimate Spellbook");
  } else if (/^(?:adventure modes?|режимы? приключени\p{L}*|приключенческий режим)$/iu.test(text)) {
    const plural = /^adventure modes$|^режимы\s+приключени/iu.test(text);
    add(plural ? "adventure-modes" : "adventure-mode", /режим|приключен/i.test(text) ? text : (plural ? "Adventure Modes" : "Adventure Mode"));
  } else if (/^(?:battlefest(?:\s+(?:season\s*)?s?\d+)?|боевой фестиваль(?:\s+сезон\s*\d+)?|батлфест(?:\s+сезон\s*\d+)?)$/i.test(text)) {
    const season = text.match(/(?:season|сезон)\s*s?(\d+)/i)?.[1];
    add(`battlefest${season ? `-season-${season}` : ""}`, text);
  } else if (/^(?:unbound frenzy|отвязное безумие)$/i.test(text)) {
    add("unbound-frenzy", /отвязное/i.test(text) ? "Отвязное безумие" : "Unbound Frenzy");
  } else if (/^(?:sonic waves(?:\s+season theme)?|звуковые волны(?:\s+тема сезона)?)$/i.test(text)) {
    add("sonic-waves", /звуковые/i.test(text) ? "Звуковые волны" : "Sonic Waves");
  } else if (/^(?:training camp|тренировочная площадка)$/i.test(text)) {
    add("training-camp", /трениров/i.test(text) ? "Тренировочная площадка" : "Training Camp");
  } else if (/^(?:custom mode|своя игра)$/i.test(text)) {
    add("custom-mode", /своя/i.test(text) ? "Своя игра" : "Custom Mode");
  }

  if (!modes.length) return null;
  return {
    type: "game-mode",
    modeSlugs: modes.map((mode) => mode.slug),
    modeNames: modes.map((mode) => mode.name),
  };
}

function getModeChangeCategory(value) {
  const text = cleanText(value);
  if (/^(?:augment pool adjustments?|корректировки пула усилений|изменения пула усилений)$/i.test(text)) {
    return { kind: "system", marker: null };
  }
  if (/^(?:(?:new|added)\s+)?(?:augments?|augmentations?)(?:\s+(?:changes?|adjustments?|comeback(?:\s+and\s+rotations?)?))?$|^(?:augments?|augmentations?)\s+(?:changes?|adjustments?)$|^изменения\s+(?:усилений|аугментов|аугментаций)|^(?:новые\s+)?(?:усиления|аугментации)(?:\s+(?:изменения|правки))?$/i.test(text)) {
    return { kind: "augment", marker: /^(?:new|added)|^новые/i.test(text) ? "new" : null };
  }
  if (/^(?:champion changes?(?:\s*[-–—].*)?|champions? balance(?:\s+(?:changes?|adjustments?))?|champion adjustments?|(?:(?:season[- ]exclusive|seasonal)\s+)?champion (?:buffs?|nerfs?)|champion cameos|(?:изменения|правки|корректировки)(?: баланса)? чемпионов(?:\s*[-–—].*)?|баланс чемпионов|(?:сезонные )?(?:усиления|ослабления) чемпионов(?:,.*)?|камео чемпионов)$/i.test(text)) {
    return { kind: "champion", marker: null };
  }
  if (/^(?:item changes?|item adjustments?|new items?|изменения предметов|корректировки предметов|новые предметы)$/i.test(text)) {
    return { kind: "item", marker: /^new|новые/i.test(text) ? "new" : null };
  }
  return null;
}

function modeScopeName(scope, fallback) {
  return scope?.modeNames?.length ? scope.modeNames.join(" & ") : fallback;
}

function scopedModeSectionName(scope, modeHeading, categoryHeading) {
  const modeName = modeScopeName(scope, modeHeading);
  return [modeName, categoryHeading].filter(Boolean).join(" · ");
}

function isModeAugmentComponentHeading(value) {
  return /^(?:empowered effect|base effect|enhanced effect|усиленный эффект|базовый эффект|улучшенный эффект)$/i.test(cleanText(value));
}

function headingHasOnlyNestedContent(blocks, index, $, level) {
  let hasTextContent = false;
  let hasNestedHeading = false;
  for (let next = index + 1; next < blocks.length; next += 1) {
    const tag = String(blocks[next].tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const nextLevel = Number(tag.slice(1));
      if (nextLevel <= level) break;
      hasNestedHeading = true;
      break;
    }
    if (["p", "li"].includes(tag) && cleanText($(blocks[next]).text())) hasTextContent = true;
  }
  return hasNestedHeading && !hasTextContent;
}

function headingHasNestedHeading(blocks, index, level) {
  for (let next = index + 1; next < blocks.length; next += 1) {
    const tag = String(blocks[next].tagName || "").toLowerCase();
    if (!/^h[1-6]$/.test(tag)) continue;
    const nextLevel = Number(tag.slice(1));
    if (nextLevel <= level) return false;
    return true;
  }
  return false;
}

function headingHasFollowingEntityCategory(blocks, index, $, level) {
  for (let next = index + 1; next < blocks.length; next += 1) {
    const tag = String(blocks[next].tagName || "").toLowerCase();
    if (!/^h[1-6]$/.test(tag)) continue;
    const nextLevel = Number(tag.slice(1));
    if (nextLevel < level) return false;
    if (nextLevel !== level) continue;
    const heading = cleanText($(blocks[next]).text());
    const kind = getCategoryHeading(heading) || getArticleChangeKind(heading);
    return ["champion", "item", "rune", "spell", "augment"].includes(kind);
  }
  return false;
}

function makeGameModeScope(modeScope) {
  return {
    type: "game-mode",
    modeSlugs: modeScope?.modeSlugs || [],
    modeNames: modeScope?.modeNames || [],
  };
}

function slugifyModeEntityName(value) {
  return normalizeEntityName(value)
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-+|-+$/g, "") || null;
}

function isNewContentGroupHeading(value) {
  return /^(?:new|new content|new features|новое|новинки|новый контент|новые возможности)$/iu.test(cleanText(value));
}

function isDescribedGameModeHeading(blocks, index, $, headingLevel) {
  let introduction = "";
  for (let next = index + 1; next < blocks.length; next += 1) {
    const node = blocks[next];
    const tag = String(node.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag) && Number(tag.slice(1)) <= headingLevel) break;
    if (tag === "p") {
      introduction = cleanText($(node).text());
      break;
    }
  }
  if (!introduction) return false;
  return /\b(?:\d+\s*v\s*\d+\s+mode|mode\s+(?:where|in which|that)|new\s+(?:game\s+)?mode)\b/i.test(introduction)
    || /\b(?:new|game)\s+mode\b/i.test(introduction)
    || /(?:вариаци[яи]\s+режима|нов(?:ый|ая|ое)\s+режим|режим.{0,60}(?:где|в\s+котором))/iu.test(introduction);
}

function parseModeScopedChanges(blade, catalog, locale) {
  const html = extractRichText(blade);
  if (!html) return [];
  const $ = load(`<div>${html}</div>`, null, false);
  const blocks = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray().filter((node) => {
    const tag = String(node.tagName || "").toLowerCase();
    const element = $(node);
    return !(tag === "p" && element.parents("li").length);
  });
  const records = [];
  let modeSectionLevel = null;
  let modeSectionHeading = "Game Mode Changes";
  let newContentSectionLevel = null;
  let dynamicModeSection = false;
  let modeScope = null;
  let categoryKind = "system";
  let categoryHeading = null;
  let categoryLevel = null;
  let categoryMarker = null;
  let current = null;
  let currentHeadingLevel = null;
  let component = null;

  const flush = () => {
    if (!current) return;
    if (current.details.length || current.changeName === "new" || current.changeName === "removed") {
      if (!current.details.length) current.details.push({
        label: null,
        before: null,
        after: null,
        text: current.changeName === "new" ? "New augment." : "Removed from the game.",
      });
      records.push(current);
    }
    current = null;
    currentHeadingLevel = null;
    component = null;
  };

  const start = (entityKind, entityName, headingLevel, changeName = categoryMarker, entitySlug = null) => {
    flush();
    const scope = makeGameModeScope(modeScope);
    const displayName = modeScopeName(modeScope, modeSectionHeading);
    current = {
      entityKind,
      entityName: cleanText(entityName),
      ...(entitySlug ? { entitySlug } : {}),
      changeName: changeName || null,
      sectionName: scopedModeSectionName(modeScope, displayName, categoryHeading || modeSectionHeading),
      scope,
      details: [],
    };
    currentHeadingLevel = headingLevel;
  };

  const appendDetail = (text) => {
    if (!current) {
      const scope = makeGameModeScope(modeScope);
      const modeName = modeScopeName(modeScope, modeSectionHeading);
      current = {
        entityKind: "system",
        entityName: modeName,
        changeName: null,
        sectionName: scopedModeSectionName(modeScope, modeName, categoryHeading || modeSectionHeading),
        scope,
        details: [],
      };
      currentHeadingLevel = categoryLevel;
    }
    for (const detail of parseRichTextDetail(text)) {
      current.details.push(component ? { ...detail, component } : detail);
    }
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const node = blocks[index];
    const tag = String(node.tagName || "").toLowerCase();
    const text = patchArticleNodeText(node, $);
    if (!text) continue;

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      if (level <= 2) {
        newContentSectionLevel = isNewContentGroupHeading(text) ? level : null;
      } else if (newContentSectionLevel !== null && level <= newContentSectionLevel) {
        newContentSectionLevel = null;
      }

      const titledModeScope = getGameModeChangesScope(text);
      if (isGameModeChangesHeading(text) || titledModeScope) {
        flush();
        modeSectionLevel = level;
        modeSectionHeading = text;
        newContentSectionLevel = null;
        dynamicModeSection = false;
        modeScope = titledModeScope;
        categoryKind = "system";
        categoryHeading = null;
        categoryLevel = level;
        categoryMarker = null;
        continue;
      }

      const standaloneMode = modeSectionLevel === null ? getGameModeScope(text) : null;
      if (standaloneMode) {
        flush();
        modeSectionLevel = level;
        modeSectionHeading = text;
        modeScope = standaloneMode;
        dynamicModeSection = false;
        categoryKind = "system";
        categoryHeading = null;
        categoryLevel = level;
        categoryMarker = null;
        continue;
      }

      if (modeSectionLevel === null && newContentSectionLevel !== null && level > newContentSectionLevel
        && !getCategoryHeading(text) && !getArticleChangeKind(text)
        && isDescribedGameModeHeading(blocks, index, $, level)) {
        flush();
        modeSectionLevel = level;
        modeSectionHeading = locale === "ru-ru" ? "ИЗМЕНЕНИЯ ИГРОВЫХ РЕЖИМОВ" : "GAME MODE CHANGES";
        dynamicModeSection = true;
        modeScope = {
          type: "game-mode",
          modeSlugs: [slugifyModeEntityName(text)].filter(Boolean),
          modeNames: [text],
        };
        categoryKind = "system";
        categoryHeading = null;
        categoryLevel = level;
        categoryMarker = null;
        continue;
      }

      if (modeSectionLevel === null) continue;
      const recognizedMode = getGameModeScope(text);
      if (recognizedMode) {
        flush();
        modeScope = recognizedMode;
        categoryKind = "system";
        categoryHeading = null;
        categoryLevel = level;
        categoryMarker = null;
        continue;
      }

      const modeCategory = getModeChangeCategory(text);
      if (modeCategory) {
        flush();
        categoryKind = modeCategory.kind;
        categoryHeading = text;
        categoryLevel = level;
        categoryMarker = modeCategory.marker;
        continue;
      }

      if (dynamicModeSection && getCategoryHeading(text)
        && !["system", "game-mode"].includes(getCategoryHeading(text))) {
        flush();
        modeSectionLevel = null;
        modeScope = null;
        dynamicModeSection = false;
        categoryHeading = null;
        categoryKind = "system";
        continue;
      }

      if (level <= modeSectionLevel) {
        flush();
        modeSectionLevel = null;
        modeScope = null;
        dynamicModeSection = false;
        categoryHeading = null;
        categoryKind = "system";
        continue;
      }

      if (!modeScope && categoryHeading === null && level <= modeSectionLevel + 1) {
        flush();
        modeScope = {
          type: "game-mode",
          modeSlugs: [slugifyModeEntityName(text)].filter(Boolean),
          modeNames: [text],
        };
        categoryKind = "system";
        categoryHeading = null;
        categoryLevel = level;
        continue;
      }

      if (current && level > currentHeadingLevel && isModeAugmentComponentHeading(text)) {
        component = text;
        continue;
      }

      if (categoryKind === "augment" && level > (categoryLevel ?? modeSectionLevel)) {
        if (current && level > currentHeadingLevel && isModeAugmentComponentHeading(text)) {
          component = text;
          continue;
        }
        if (headingHasOnlyNestedContent(blocks, index, $, level)) {
          flush();
          continue;
        }
        const marker = categoryMarker || (/^(?:new|added)\s+/i.test(text) ? "new" : null);
        start("augment", stripEntityMarker(text), level, marker, slugifyModeEntityName(text));
        continue;
      }

      if (categoryKind === "champion" && level > (categoryLevel ?? modeSectionLevel)) {
        const mention = findCatalogChampionHeading(text, catalog);
        const champion = getCatalogEntity("champion", text, catalog) || mention?.entity;
        if (champion || mention || isStructuralChampionHeading(blocks, index, $, catalog, currentHeadingLevel)) {
          const entityName = getLocalizedChampionHeadingName(text, mention, champion, text, locale);
          start("champion", entityName, level, categoryMarker, champion?.slug || null);
          continue;
        }
        if (current && level > currentHeadingLevel) {
          component = text;
          continue;
        }
      }

      if (categoryKind === "item" && level > (categoryLevel ?? modeSectionLevel)) {
        const mention = findRichTextItemMention(text, catalog);
        const item = getCatalogEntity("item", text, catalog) || mention?.entity;
        const structuralItemHeading = level === categoryLevel + 1
          || (current?.entityKind === "item" && level <= currentHeadingLevel);
        if (item || categoryMarker || structuralItemHeading) {
          start("item", getLocalizedCatalogAlias(text, mention?.alias) || item?.name || stripEntityMarker(text), level, categoryMarker, item?.slug || null);
          continue;
        }
      }

      if (current && level <= currentHeadingLevel) flush();
      if (categoryKind === "system" && level >= (categoryLevel ?? modeSectionLevel)) {
        start("system", text, level, null, null);
      } else if (current && level > currentHeadingLevel) {
        component = text;
      }
      continue;
    }

    if (modeSectionLevel === null) continue;
    if (tag === "p") {
      const lines = String($(node).html() || "")
        .split(/<br\s*\/?\s*>/i)
        .map((line) => htmlToText(line))
        .map(cleanText)
        .filter(Boolean);
      if (lines.some((line) => getGameModeScope(line))) {
        for (const line of lines) {
          const inlineMode = getGameModeScope(line);
          if (inlineMode) {
            flush();
            modeScope = inlineMode;
            categoryKind = "system";
            categoryHeading = null;
            categoryLevel = modeSectionLevel;
            categoryMarker = null;
            component = null;
          } else {
            appendDetail(line);
          }
        }
        continue;
      }
    }
    appendDetail(text);
  }

  flush();
  return records;
}

function isPostModePatchSectionHeading(value) {
  return /^(?:bug fixes|error fixes|исправлен[а-яё]* ошибок|исправлен[а-яё]* багов|skins?|облики?|образы?)$/i.test(cleanText(value));
}

function advanceIgnoredGameModeScope(title, level, ignoredModeLevel) {
  // Mode categories can use a shallower heading than their mode wrapper.
  // Keep both parsing passes in the same scope instead of emitting core duplicates.
  if (ignoredModeLevel !== null && getModeChangeCategory(title)) return Math.min(level, ignoredModeLevel);
  if (ignoredModeLevel !== null
    && (level <= ignoredModeLevel || isPostModePatchSectionHeading(title))) ignoredModeLevel = null;
  return isGameModeHeading(title) ? level : ignoredModeLevel;
}

function collectExplicitNewItemNames(blades, catalog) {
  const paragraphs = [];
  for (const blade of Array.isArray(blades) ? blades : []) {
    const html = extractRichText(blade);
    if (!html) continue;
    const $ = load(`<div>${html}</div>`, null, false);
    paragraphs.push(...$.root().children().first().find("p").toArray().map((node) => cleanText($(node).text())));
  }
  const cues = paragraphs.filter((text) => /(?:new items?\b|added (?:to the game|in game)|new component\b|new option\b|new addition\b|introducing\s+[\w'’-]+|we(?:'|’)re introducing|новые предметы(?:\s|[,.:]|$)|добав(?:ляем|или) в игру|появ(?:ится|ятся) в магазине|нов(?:ый|ая|ое) компонент(?:\s|[,.:]|$)|нов(?:ый|ая|ое) предмет(?:\s|[,.:]|$)|новой опцией|новинка)/i.test(text));
  const names = new Set();
  for (const text of cues) {
    const normalized = normalizeEntityName(text);
    for (const alias of catalog?.items?.keys() || []) {
      if (alias.length >= 5 && normalized.includes(alias)) names.add(alias);
    }
  }
  return names;
}

function collectExplicitNewRuneNames(blades, catalog) {
  const paragraphs = [];
  for (const blade of Array.isArray(blades) ? blades : []) {
    const html = extractRichText(blade);
    if (!html) continue;
    const $ = load(`<div>${html}</div>`, null, false);
    paragraphs.push(...$.root().children().first().find("p").toArray().map((node) => cleanText($(node).text())));
  }
  const cues = paragraphs.filter((text) => /(?:new rune\b|new runes\b|introduced the new rune|new rune options|нов(?:ая|ые) руна|новых рун|добавили новую руну|ввели новую руну)/i.test(text));
  const names = new Set();
  for (const text of cues) {
    const normalized = normalizeEntityName(text);
    for (const alias of catalog?.runes?.keys() || []) {
      if (alias.length >= 4 && normalized.includes(alias)) names.add(alias);
    }
  }
  return names;
}

function createRichTextChangeState(sectionName, catalog, explicitNewItemNames, explicitNewRuneNames, locale) {
  return {
    catalog,
    locale,
    explicitNewItemNames,
    explicitNewRuneNames,
    records: [],
    sectionName,
    entityKind: null,
    categoryMarker: null,
    categoryHeadingLevel: null,
    genericSystemWrapperLevel: null,
    ignoredGameMode: false,
    ignoredGameModeLevel: null,
    current: null,
    currentEntityHeadingLevel: null,
    currentSystemComponent: null,
    currentListComponent: null,
    removedItemSlugs: new Set(),
    removedItemListActive: false,
  };
}

function flushRichTextChange(state) {
  const { current, records } = state;
  if (current?.splitAsEntities && current.details.length) {
    const seen = new Set();
    for (const detail of current.details) {
      const entityName = cleanText(detail.text);
      const key = entityName.toLowerCase().replace(/ё/g, "е");
      if (!entityName || !/[\p{L}\p{N}]/u.test(entityName) || /^см\.?\s+выше\.?$/i.test(entityName) || seen.has(key)) continue;
      seen.add(key);
      records.push({
        entityKind: current.entityKind,
        sectionName: current.sectionName,
        entityName,
        changeName: current.changeName || "removed",
        details: [{ label: null, before: null, after: null, text: "Предмет удален из игры." }],
      });
    }
  } else if ((current?.entityKind === "system" || /[\p{L}\p{N}]/u.test(current?.entityName || ""))
    && (current?.details.length || current?.changeName === "new" || current?.changeName === "removed")) {
    if (!current.details.length && current.entityKind !== "system") current.details.push({
      label: null,
      before: null,
      after: null,
      text: current.changeName === "new" ? "Новый объект." : "Удален из игры.",
    });
    if (current.details.length) records.push(current);
  }
  state.current = null;
  state.currentEntityHeadingLevel = null;
}

function startRichTextEntity(state, kind, name, heading, marker = null, knownEntity = null) {
  flushRichTextChange(state);
  const catalogEntity = knownEntity || getCatalogEntity(kind, name, state.catalog);
  const localizedName = ["item", "rune", "spell"].includes(kind) && /[A-Za-z]/.test(name)
    ? getRussianPatchEntityName(name, kind, state.locale, catalogEntity)
    : null;
  const entityName = localizedName || name;
  state.current = {
    entityKind: kind,
    sectionName: state.sectionName || heading,
    entityName: stripEntityMarker(entityName),
    ...(catalogEntity?.slug ? { entitySlug: catalogEntity.slug } : {}),
    changeName: marker || null,
    details: [],
  };
  if (marker === "removed") state.current.details.push({
    label: null, before: null, after: null, text: "Удален из игры.",
  });
  state.currentSystemComponent = null;
  state.currentListComponent = null;
}

function handleRichTextTopHeading(state, text, tag, hasNestedHeading = false) {
  const level = Number(tag.slice(1));
  const enclosingKind = state.entityKind;
  const enclosingCategoryLevel = state.categoryHeadingLevel;
  state.ignoredGameModeLevel = advanceIgnoredGameModeScope(text, level, state.ignoredGameModeLevel);
  flushRichTextChange(state);
  state.sectionName = text;
  const isModeSection = isGameModeHeading(text)
    || /game mode changes|игровых? режим|режим приключени|^adventure mode$/i.test(text);
  if (isModeSection) state.ignoredGameModeLevel = level;
  state.ignoredGameMode = state.ignoredGameModeLevel !== null || isModeSection;
  const explicitHeadingKind = getCategoryHeading(text) || getArticleChangeKind(text)
    || (isRuneTreeHeading(text) ? "rune" : null);
  state.removedItemListActive = explicitHeadingKind === "item"
    && getCategoryMarker(text) === "removed"
    && isRemovedItemCategoryHeading(text);
  const inferredSystemWrapper = !explicitHeadingKind
    && hasNestedHeading
    && hasSupplementalSystemHeadingSignal(text);
  const headingKind = explicitHeadingKind || (inferredSystemWrapper ? "system" : null);
  const nestedSystemHeading = !headingKind
    && !state.ignoredGameMode
    && enclosingKind === "system"
    && enclosingCategoryLevel !== null
    && level > enclosingCategoryLevel;
  state.entityKind = state.ignoredGameMode ? null : headingKind || (nestedSystemHeading ? "system" : null);
  state.categoryMarker = getCategoryMarker(text);
  state.categoryHeadingLevel = headingKind || nestedSystemHeading ? level : null;
  state.genericSystemWrapperLevel = !state.ignoredGameMode && (inferredSystemWrapper || nestedSystemHeading) ? level : null;
  state.currentSystemComponent = null;
  state.currentListComponent = null;
}

function handleRichTextCategoryHeading(state, text, tag, hasNestedHeading = false) {
  if (state.entityKind === "rune" && /^(?:champion|class|contraction)$/i.test(cleanText(stripEntityMarker(text)))) {
    flushRichTextChange(state);
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    state.categoryMarker = null;
    return true;
  }
  const kind = getCategoryHeading(text);
  if (!kind) return false;
  if (kind === "spell" && isNestedSpellEntityHeading(state, text, tag)) return false;
  const headingLevel = Number(tag.slice(1));
  if (kind === "item" && state.entityKind === "item"
    && state.categoryHeadingLevel !== null
    && headingLevel > state.categoryHeadingLevel) {
    flushRichTextChange(state);
    if (!isBootTierPurchaseRegulationHeading(text)) state.sectionName = text;
    state.categoryMarker = getCategoryMarker(text);
    state.removedItemListActive = state.categoryMarker === "removed" && isRemovedItemCategoryHeading(text);
    if (hasNestedHeading || isItemCollectionHeading(text)) state.categoryHeadingLevel = headingLevel;
    state.currentSystemComponent = null;
    state.currentListComponent = null;
    return true;
  }
  flushRichTextChange(state);
  state.entityKind = kind;
  state.sectionName = text;
  state.categoryMarker = getCategoryMarker(text);
  state.removedItemListActive = kind === "item"
    && state.categoryMarker === "removed"
    && isRemovedItemCategoryHeading(text);
  state.categoryHeadingLevel = headingLevel;
  state.currentSystemComponent = null;
  state.currentListComponent = null;
  return true;
}

function isNestedSpellEntityHeading(state, text, tag) {
  if (state.entityKind !== "spell" || state.categoryHeadingLevel === null) return false;
  const headingLevel = Number(tag.slice(1));
  if (headingLevel <= state.categoryHeadingLevel) return false;
  return isBareSpellHeading(text)
    || Boolean(getCatalogEntity("spell", text, state.catalog) || findCatalogSpellMention(text, state.catalog));
}

function handleRichTextItemHeading(state, text, tag) {
  if (state.entityKind === "item" && isItemComponentHeading(text)) {
    state.currentSystemComponent = getItemComponentLabel(text);
    return;
  }
  if (isRemovedItemCategoryHeading(text)) {
    flushRichTextChange(state);
    state.categoryMarker = "removed";
    state.removedItemListActive = true;
    state.current = {
      entityKind: "item", sectionName: state.sectionName, entityName: text, changeName: null,
      details: [], splitAsEntities: true,
    };
    return;
  }
  state.removedItemListActive = false;
  const itemName = stripItemHeadingDecorations(text);
  const headingEntityName = stripItemUpgradeParenthetical(itemName);
  const modeQualifiedItem = hasQualifiedItemAlias(headingEntityName, state.catalog);
  const itemMention = modeQualifiedItem ? null : findRichTextItemMention(headingEntityName, state.catalog);
  const mentionedItems = /(?:→|->)/.test(itemName) && itemMention
    ? [itemMention]
    : modeQualifiedItem ? [] : findCatalogItemsInText(headingEntityName, state.catalog);
  const distinctItems = new Set(mentionedItems.map(({ entity, alias }) => entity.slug || normalizeEntityName(alias)));
  if (distinctItems.size > 1) {
    flushRichTextChange(state);
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  const marker = getItemHeadingMarker(text) || state.categoryMarker
    || (state.explicitNewItemNames.has(normalizeEntityName(itemName)) ? "new" : null);
  const knownItem = modeQualifiedItem ? null : getCatalogEntity("item", itemName, state.catalog) || itemMention?.entity;
  const headingLevel = Number(String(tag || "").slice(1));
  const isDirectItemHeading = state.categoryHeadingLevel !== null
    && headingLevel === state.categoryHeadingLevel + 1;
  if (knownItem || marker || isDirectItemHeading) {
    startRichTextItemHeading(state, itemName, marker, itemMention, knownItem);
    return;
  }
  flushRichTextChange(state);
  state.currentSystemComponent = text.replace(/:\s*$/, "");
}

function findRichTextItemMention(text, catalog) {
  const sourceName = stripItemHeadingDecorations(text);
  const qualifiedVariant = resolveQualifiedItemVariant(sourceName, catalog?.items);
  if (qualifiedVariant) {
    return { alias: normalizeEntityName(sourceName), entity: qualifiedVariant };
  }
  if (hasQualifiedItemAlias(sourceName, catalog)) return null;
  const transitionParts = sourceName.split(/\s*(?:→|->)\s*/).map((part) => part.trim()).filter(Boolean);
  if (transitionParts.length === 2) {
    const targetMention = findCatalogLead("item", transitionParts[1], catalog)
      || findCatalogMention("item", transitionParts[1], catalog)
      || getParserFallbackItem(transitionParts[1], catalog);
    if (targetMention) {
      return targetMention.entity ? targetMention : { entity: targetMention, alias: normalizeEntityName(transitionParts[1]) };
    }
  }
  const exactAlias = normalizeEntityName(sourceName);
  const exactItem = catalog?.items?.get(exactAlias) || getCatalogEntity("item", sourceName, catalog);
  if (exactItem) return { alias: exactAlias, entity: exactItem };
  const mention = findCatalogLead("item", sourceName, catalog) || findCatalogMention("item", sourceName, catalog);
  const normalizedAlias = normalizeEntityName(mention?.alias || "");
  if (mention && (normalizedAlias === exactAlias || exactAlias.endsWith(` ${normalizedAlias}`))) return mention;
  const fallback = getParserFallbackItem(sourceName, catalog);
  return fallback ? { entity: fallback, alias: normalizeEntityName(sourceName) } : null;
}

function stripItemHeadingDecorations(value) {
  const source = cleanText(value)
    .replace(/^[.·]\s*(?=\[(?:new|added|introduced|removed|deleted|новое|добавлено|удалено|удалённо)\])/iu, "")
    .replace(/\s*[.·]\s*(?:stats?|statistics|parameters?|характеристики|параметры)\s*$/iu, "")
    .replace(/\s*\[(?:(?:new|added|introduced)\s+(?:to|for)\s+(?:this|the)\s+mode|(?:new|added|introduced)\s+in\s+[^\]]+\s+mode|(?:новинка|добавлено|нов(?:ое|ый|ая))\s+(?:в\s+[^\]]*режим(?:е|ах)[^\]]*|для\s+(?:этого|данного)\s+режима))\]\s*[.!?]?$/iu, "")
    .replace(/\s*[.!?]\s*$/u, "")
    .replace(/^\s*[.·]\s*(?=\[)/u, "");
  return cleanText(stripEntityMarker(source))
    .replace(/^(?:(?:new|added|introduced)\s+)?(?:enchantments?|items?)\s*:\s*/i, "")
    .replace(/^(?:(?:нов(?:ый|ая|ое|ые)|добавлен[а-яё]*|удал[её]н[а-яё]*)\s+)?(?:зачаровани[а-яё]*|предмет[а-яё]*)\s*:\s*/i, "")
    .replace(/^(?:removed|deleted|удалено|удал[её]н[а-яё]*)\s*:\s*/i, "")
    .replace(/\s*\[(?:(?:new|added|introduced)\s+(?:to|for)\s+(?:this|the)\s+mode|(?:new|added|introduced)\s+in\s+[^\]]+\s+mode|(?:новинка|добавлено|нов(?:ое|ый|ая))\s+(?:в\s+[^\]]*режим(?:е|ах)[^\]]*|для\s+(?:этого|данного)\s+режима))\]\s*$/iu, "")
    .replace(/\s*\[(?:new|added|introduced|removed|deleted|новое|добавлено|удалено|удалённо)\]\s*$/iu, "")
    .replace(/\s*\((?:new|added|introduced|removed|deleted|новое|добавлено|удалено|удалённо)\)\s*$/iu, "")
    .replace(/\s*[-–—]\s*(?:removed|deleted|удален[а-яё]*|удалён[а-яё]*)\s*$/i, "")
    .trim();
}

function stripItemUpgradeParenthetical(value) {
  return cleanText(value)
    .replace(/\s+\([^()]*\b(?:upgrade|улучшен\p{L}*)[^()]*\)\s*$/iu, "")
    .trim();
}

function getItemHeadingMarker(value) {
  const text = cleanText(value);
  const marker = getEntityMarker(text);
  if (marker) return marker;
  if (/\[(?:new|added|introduced)\s+(?:to|for)\s+(?:this|the)\s+mode|(?:new|added|introduced)\s+in\s+[^\]]+\s+mode\]/i.test(text)
    || /\[(?:новинка|добавлено|нов(?:ое|ый|ая)\s+в\s+[^\]]*режим(?:е|ах)[^\]]*|добавлено\s+для\s+этого\s+режима)\]/iu.test(text)) return "new";
  if (/^(?:new|added|introduced)\s+(?:enchantments?|items?)\s*:/i.test(text)
    || /^(?:нов(?:ый|ая|ое|ые)|добавлен[а-яё]*)\s+(?:зачаровани[а-яё]*|предмет[а-яё]*)\s*:/i.test(text)) return "new";
  if (/^(?:removed|deleted|удалено|удал[её]н[а-яё]*)\s*:/i.test(text)
    || /\s*[-–—]\s*(?:removed|deleted|удален[а-яё]*|удалён[а-яё]*)\s*$/i.test(text)) return "removed";
  return null;
}

function startRichTextItemHeading(state, text, marker, mention, item) {
  const localizedAlias = getLocalizedCatalogAlias(text, mention?.alias);
  const isTransition = /(?:→|->)/.test(text);
  const entityName = localizedAlias
    || getRussianPatchEntityName(text, "item", state.locale, item)
    || (item?.itemVariant ? formatHeadingDisplayName(localizedAlias || text, state.locale) : null)
    || (isTransition ? item?.name : null)
    || formatHeadingDisplayName(stripEntityMarker(text), state.locale);
  startRichTextEntity(state, "item", entityName, state.sectionName, marker, item);
  if (!/(?:→|->)/.test(text)) return;
  const detailText = item ? extractItemHeadingDetail(text, item, state.catalog) : text;
  appendUniqueRichTextDetails(state.current, parseRichTextDetail(detailText));
}

function extractItemHeadingDetail(text, item, catalog) {
  const itemName = cleanText(item?.name || item?.tooltipTitle || "");
  if (!itemName) return text;
  const aliases = Array.from(catalog?.items?.entries() || [])
    .filter(([, entity]) => entity?.slug && entity.slug === item.slug)
    .map(([alias]) => alias)
    .sort((left, right) => right.length - left.length);
  if (!aliases.length) aliases.push(normalizeEntityName(itemName));
  const itemPatterns = aliases.map((alias) => alias.split(" ").map(escapeRegex).join("[^\\p{L}\\p{N}]*"));
  const match = String(text).match(new RegExp(`^(.*?)\\s*(?:${itemPatterns.join("|")})\\s*$`, "iu"));
  return match?.[1] && /(?:→|->)/.test(match[1]) ? match[1].trim() : text;
}

function handleRichTextEntityHeading(state, text, tag) {
  const { entityKind, catalog } = state;
  if (entityKind === "system" && /^(?:smite|кара)$/i.test(stripEntityMarker(text))) {
    const spell = getCatalogEntity("spell", text, catalog) || findCatalogSpellMention(text, catalog)?.entity;
    if (spell) {
      flushRichTextChange(state);
      state.entityKind = "spell";
      startRichTextEntity(state, "spell", getCatalogArticleName(text, "spell", catalog, spell.name || text, state.locale), state.sectionName, getEntityMarker(text) || state.categoryMarker);
      return;
    }
  }
  if (entityKind === "item") {
    handleRichTextItemHeading(state, text, tag);
    return;
  }
  if (entityKind === "spell") {
    const mention = findCatalogSpellMention(text, catalog);
    const marker = getEntityMarker(text) || state.categoryMarker;
    if (mention || marker || isBareSpellHeading(text)) {
      const entityName = getCatalogArticleName(text, "spell", catalog, stripEntityMarker(text), state.locale);
      startRichTextEntity(state, "spell", entityName, state.sectionName, marker);
    }
    else state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  if (entityKind === "champion") {
    handleRichTextChampionHeading(state, text);
    return;
  }
  if (["rune", "spell", "skin"].includes(entityKind)) {
    handleRichTextRuneSpellOrSkinHeading(state, text, entityKind);
    return;
  }
  if (entityKind === "system") {
    startRichTextEntity(state, "system", formatHeadingDisplayName(stripEntityMarker(text), state.locale), state.sectionName,
      getEntityMarker(text) || state.categoryMarker);
  }
}

function getRichTextChampionMarker(state, text) {
  return getEntityMarker(text) || (state.entityKind === "champion" ? state.categoryMarker : null);
}

function isUncataloguedChampionSectionComponent(champion, marker, text) {
  return !champion && marker === "new" && !text.includes(",") && /\s/u.test(text);
}

function handleRichTextChampionHeading(state, text, structuralHeading = false) {
  const mention = findCatalogChampionHeading(text, state.catalog);
  const champion = getCatalogEntity("champion", text, state.catalog) || mention?.entity;
  const marker = getRichTextChampionMarker(state, text);
  if (!champion && !marker && !structuralHeading) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  if (!structuralHeading && isUncataloguedChampionSectionComponent(champion, marker, text)) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  const headingName = !champion && marker === "new" ? cleanText(text.split(",", 1)[0]) : text;
  const entityName = getLocalizedChampionHeadingName(text, mention, champion, headingName, state.locale);
  startRichTextEntity(state, "champion", entityName, state.sectionName, marker);
  if (champion?.slug) state.current.entitySlug = champion.slug;
}

function handleRichTextRuneSpellOrSkinHeading(state, text, entityKind) {
  const runeStatusHeading = cleanText(stripRuneEntityMarker(text));
  if (entityKind === "rune" && /^(?:removed|deleted|new|added|introduced|удал[её]но|нов(?:ое|ая|ый|ые)|добавлен[а-яё]*|введен[а-яё]*)$/iu.test(runeStatusHeading)) {
    flushRichTextChange(state);
    state.categoryMarker = getCategoryMarker(text);
    state.currentSystemComponent = null;
    return;
  }
  if (entityKind === "rune" && isRuneTreeHeading(text)) {
    flushRichTextChange(state);
    state.sectionName = text;
    return;
  }
  if (entityKind === "rune" && /^(?:other inspiration runes|остальные руны вдохновения)$/i.test(text)) {
    startRichTextEntity(state, "system", text, state.sectionName);
    state.entityKind = "system";
    return;
  }
  if (entityKind === "item" && isItemComponentHeading(text)) {
    state.currentSystemComponent = getItemComponentLabel(text);
    return;
  }
  const marker = getEntityMarker(text)
    || (entityKind === "rune" && state.explicitNewRuneNames.has(normalizeEntityName(stripRuneCategoryPrefix(stripRuneEntityMarker(text)))) ? "new" : null)
    || state.categoryMarker;
  const runeEntity = entityKind === "rune" ? getCatalogEntity("rune", text, state.catalog) : null;
  const runeHasDisplayWrapper = /^\s*[–—-]?\s*(?:\[(?:reworked|updated|adjusted|переработка|переработан[а-яё]*|обновлен[а-яё]*|изменен[а-яё]*)\]|(?:class|contraction)\s*:|(?:(?:champion\s+)?runes?)\s+(?:replaced|rewritten|changed)\s+by)/iu.test(text);
  const fallbackName = entityKind === "rune"
    ? (runeEntity
      ? runeHasDisplayWrapper
        ? runeEntity.name || stripRuneCategoryPrefix(stripRuneEntityMarker(text))
        : stripRuneEntityMarker(text).replace(/^runes?\s*:?\s*/i, "")
      : stripRuneCategoryPrefix(stripRuneEntityMarker(text)))
    : stripEntityMarker(text);
  const entityName = entityKind === "skin"
    ? stripEntityMarker(text)
    : getCatalogArticleName(text, entityKind, state.catalog, fallbackName, state.locale);
  startRichTextEntity(state, entityKind, entityName, state.sectionName, marker, runeEntity);
}

function stripRuneEntityMarker(value) {
  return cleanText(value)
    .replace(/^\s*(?:\[|\()(?:new|added|introduced|reworked|updated|adjusted|нов(?:ое|ая|ый|ые)|добавлен[а-яё]*|переработан[а-яё]*|переработка|обновлен[а-яё]*|изменен[а-яё]*|удален[а-яё]*|удалён[а-яё]*|removed|deleted)(?:\]|\))\s*/iu, "")
    .replace(/\s*(?:\[|\()(?:new|added|introduced|reworked|updated|adjusted|нов(?:ое|ая|ый|ые)|добавлен[а-яё]*|переработан[а-яё]*|переработка|обновлен[а-яё]*|изменен[а-яё]*|удален[а-яё]*|удалён[а-яё]*|removed|deleted)(?:\]|\))\s*$/iu, "")
    .trim();
}

function stripRuneCategoryPrefix(value) {
  return cleanText(value)
    .replace(/^[\s–—-]+/u, "")
    .replace(/^\[(?:reworked|updated|adjusted|переработка|переработан[а-яё]*|обновлен[а-яё]*|изменен[а-яё]*)\]\s*/iu, "")
    .replace(/^(?:class|contraction|contraption)\s*:\s*/i, "")
    .replace(/^(?:(?:champion\s+)?runes?)\s+(?:replaced|rewritten|changed)\s+by\s+/i, "")
    .replace(/^\[(?:new|added|introduced|reworked|updated|adjusted|removed|deleted|нов(?:ое|ая|ый|ые)|добавлен[а-яё]*|переработка|переработан[а-яё]*|обновлен[а-яё]*|изменен[а-яё]*|удален[а-яё]*|удалён[а-яё]*)\]\s*/iu, "")
    .replace(/^(?:runes?|keystone|legend|domination|sorcery|resolve|precision|inspiration|ключевая руна|ключевые руны|легенда|доминирование|колдовство|храбрость|точность|вдохновение)\s*:?\s*/iu, "")
    .replace(/^\[(?:new|added|introduced|reworked|updated|adjusted|removed|deleted|нов(?:ое|ая|ый|ые)|добавлен[а-яё]*|переработка|переработан[а-яё]*|обновлен[а-яё]*|изменен[а-яё]*|удален[а-яё]*|удалён[а-яё]*)\]\s*/iu, "")
    .trim();
}

function handleRichTextSubheading(state, text, tag, hasNestedHeading = false) {
  if (handleRichTextCategoryHeading(state, text, tag, hasNestedHeading)) return;
  if (!state.entityKind) return;
  if (isGameModeHeading(text)) {
    flushRichTextChange(state);
    state.ignoredGameMode = true;
    state.entityKind = null;
    return;
  }
  const headingLevel = Number(tag.slice(1));
  if (state.entityKind === "item"
    && hasNestedHeading
    && getArticleChangeKind(text) === "item"
    && !getCatalogEntity("item", text, state.catalog)
    && !getEntityMarker(text)) {
    flushRichTextChange(state);
    state.sectionName = text;
    state.categoryHeadingLevel = headingLevel;
    state.currentSystemComponent = null;
    state.currentListComponent = null;
    return;
  }
  if (state.categoryHeadingLevel !== null && headingLevel <= state.categoryHeadingLevel) {
    // A sibling heading ends the current category block. Without this reset,
    // headings such as EVENTS after NEW CHAMPIONS inherit the "new champion"
    // marker and are emitted as fictitious champion records.
    flushRichTextChange(state);
    state.entityKind = null;
    state.categoryMarker = null;
    state.categoryHeadingLevel = null;
    state.currentSystemComponent = null;
    state.currentListComponent = null;
    state.sectionName = text;
    return;
  }
  const catalogEntity = getCatalogEntity(state.entityKind, text, state.catalog)
    || (state.entityKind === "champion" ? findCatalogChampionHeading(text, state.catalog)?.entity : null)
    || findCatalogMention(state.entityKind, text, state.catalog)?.entity;
  const sameCurrentEntity = catalogEntity && state.current?.entityKind === state.entityKind
    && (catalogEntity.slug && state.current.entitySlug
      ? catalogEntity.slug === state.current.entitySlug
      : normalizeEntityName(catalogEntity.name || text) === normalizeEntityName(state.current.entityName));
  const headingMarker = state.entityKind === "item" ? getItemHeadingMarker(text) : getEntityMarker(text);
  const isUncataloguedNestedRune = state.entityKind === "rune"
    && state.categoryHeadingLevel !== null
    && headingLevel === state.categoryHeadingLevel + 2
    && !hasNestedHeading
    && !isRuneTreeHeading(text)
    && !/^(?:removed|deleted|new|added|introduced|удал[её]но|нов(?:ое|ая|ый|ые)|добавлен[а-яё]*|введен[а-яё]*|damage|cool\s*down|cooldown|shield(?:\s+value)?|healing?|attack\s+(?:damage|speed|range)|maximum\s+health(?:\s+growth)?|урон|перезарядка|щит(?:\s+значение)?|лечени[а-яё]*|сила\s+атаки|скорость\s+атаки|здоровье(?:\s+максимальное|\s+максимум|\s+рост)?|эффект(?:\s+руны)?|длительность)$/iu.test(cleanText(stripRuneEntityMarker(text)));
  const headingStartsEntity = Boolean((catalogEntity && !sameCurrentEntity) || headingMarker || isUncataloguedNestedRune);
  if (state.current && state.categoryHeadingLevel !== null && headingLevel > state.categoryHeadingLevel + 1 && !headingStartsEntity) {
    const component = text.replace(/:\s*$/, "");
    state.currentSystemComponent = component;
    state.currentListComponent = null;
    if (state.current.entityKind === "champion" && !state.current.changeName) state.current.changeName = component;
    return;
  }
  const previousMarker = state.categoryMarker;
  if (state.current && state.categoryHeadingLevel !== null && headingLevel !== state.categoryHeadingLevel + 1) {
    state.categoryMarker = null;
  }
  handleRichTextEntityHeading(state, text, tag);
  state.categoryMarker = previousMarker;
}

function handleRichTextParagraphEntity(state, text) {
  const { entityKind, catalog, current } = state;
  const entity = getCatalogEntity(entityKind, text, catalog);
  if (!entity) return false;
  const entityName = getCatalogArticleName(text, entityKind, catalog, entity.name || text, state.locale);
  const marker = getEntityMarker(text) || state.categoryMarker
    || (entityKind === "item" && state.explicitNewItemNames.has(normalizeEntityName(stripEntityMarker(text))) ? "new" : null);
  const sameEntity = current && current.entityKind === entityKind
    && normalizeEntityName(current.entityName) === normalizeEntityName(entityName);
  if (!sameEntity) startRichTextEntity(state, entityKind, entityName, state.sectionName, marker);
  const hasChangeArrow = /(?:→|->)/.test(text);
  if (!hasChangeArrow && (!sameEntity || state.current.details.length === 0)) {
    appendUniqueRichTextDetails(state.current, [{ label: null, before: null, after: null, text }]);
  }
  return !hasChangeArrow;
}

function handleRichTextItemParagraph(state, text) {
  const mention = findCatalogLead("item", text, state.catalog)
    || (/tear of the goddess now a basic item/i.test(text)
      ? { entity: getCatalogEntity("item", "Tear of the Goddess", state.catalog), alias: "tear of the goddess" }
      : null)
    || (/слеза богини стала базовым предметом/i.test(text)
      ? { entity: getCatalogEntity("item", "Tear of the Goddess", state.catalog), alias: "слеза богини" }
      : null);
  if (!mention) {
    if (!isLikelyRichTextItemTitle(text) || !hasRichTextItemChangeAhead(state.currentNode, state.$, state.catalog)) return;
    startRichTextEntity(state, "item", formatHeadingDisplayName(stripEntityMarker(text), state.locale), state.sectionName,
      getEntityMarker(text) || state.categoryMarker);
    return;
  }
  // A catalog name at the start of an explanatory paragraph is not an item
  // heading. Starting a record for it makes the following item's stat list
  // inherit that prose (and can emit the same item twice later in the section).
  // Item paragraphs are handled as headings only when the paragraph is just
  // the catalog name; paragraphs followed by a stat list are handled by the
  // structural paragraph recognizer below.
  const normalizedText = normalizeEntityName(stripEntityMarker(text));
  if (normalizedText !== normalizeEntityName(mention.alias)) {
    if (!hasRichTextItemChangeAhead(state.currentNode, state.$, state.catalog)) return;
    if (isLikelyRichTextItemTitle(text)) {
      startRichTextEntity(state, "item", formatHeadingDisplayName(stripEntityMarker(text), state.locale), state.sectionName,
        getEntityMarker(text) || state.categoryMarker);
      return;
    }
    const matchingItems = findCatalogItemsInText(text, state.catalog);
    const uniqueItems = new Map(matchingItems.map(({ entity }) => [entity.slug, entity]));
    if (uniqueItems.size !== 1) return;
    const item = [...uniqueItems.values()][0];
    startRichTextEntity(state, "item", getCatalogArticleName(text, "item", state.catalog, item.name || text, state.locale), state.sectionName,
      getEntityMarker(text) || state.categoryMarker);
    return;
  }
  const name = getLocalizedCatalogAlias(text, mention.alias)
    || getRussianPatchEntityName(text, "item", state.locale, mention.entity)
    || mention.entity.name || mention.alias;
  const marker = getEntityMarker(text) || state.categoryMarker
    || (state.explicitNewItemNames.has(mention.alias) ? "new" : null);
  const sameEntity = state.current && normalizeEntityName(state.current.entityName) === normalizeEntityName(name);
  if (!sameEntity) startRichTextEntity(state, "item", name, state.sectionName, marker);
  else if (state.current.details.length === 0 && !/(?:→|->)/.test(text)) {
    state.current.details.push({ label: null, before: null, after: null, text });
  }
}

function isLikelyRichTextItemTitle(value) {
  const text = cleanText(value);
  if (!text || text.length > 90 || /(?:→|->)|[.!?]$/.test(text) || isItemComponentHeading(text)) return false;
  if (getCategoryHeading(text) || getArticleChangeKind(text)) return false;
  return /\p{L}/u.test(text) && text === text.toLocaleUpperCase("en-US");
}

function hasRichTextItemChangeAhead(node, $, catalog) {
  if (!node || !$) return false;
  for (let sibling = node.next; sibling; sibling = sibling.next) {
    const tag = String(sibling.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) return false;
    if (tag === "p") {
      const text = cleanText($(sibling).text());
      if (isLikelyRichTextItemTitle(text)) return false;
      if (!/^(?:base stats|основные показатели|основные параметры|notes|примечания):?$/i.test(text)
        && (getCatalogEntity("item", text, catalog) || findCatalogLead("item", text, catalog))) return false;
    }
    const detailNodes = ["ul", "ol"].includes(tag) ? $(sibling).find("li").toArray() : [sibling];
    if (detailNodes.some((detailNode) => {
      const detailText = patchArticleNodeText(detailNode, $);
      return parseRichTextDetail(detailText).some((detail) => detail.before && detail.after);
    })) return true;
  }
  return false;
}

function isRichTextItemStatParagraph(node, text, $) {
  if (!text || text.length > 80 || /(?:→|->)|[.!?]$/.test(text) || isItemComponentHeading(text)) return false;
  if (text.split(/\s+/).length > 8) return false;
  const list = $(node).next();
  if (!list.length || !["ul", "ol"].includes(String(list[0].tagName || "").toLowerCase())) return false;
  return list.children("li").toArray().some((item) => {
    const detail = parseChangeLine($(item).text());
    return Boolean(detail.before && detail.after);
  });
}

function handleUncataloguedItemComponentParagraph(state, text, knownItem, currentHasStatChanges) {
  const isComponentLabel = /[:：]\s*$/.test(text) || Boolean(state.current?.entitySlug);
  if (knownItem || state.current?.entityKind !== "item" || !isComponentLabel
    || !(currentHasStatChanges || state.current.entitySlug)) return false;
  state.currentSystemComponent = text.replace(/:\s*$/, "");
  state.currentListComponent = null;
  return true;
}

function handleRichTextItemStatParagraph(state, node, text, $) {
  if (state.entityKind !== "item" || !isRichTextItemStatParagraph(node, text, $)) return false;
  const item = getCatalogEntity("item", text, state.catalog);
  const mention = item ? null : findCatalogLead("item", text, state.catalog);
  const knownItem = item || mention?.entity;
  const currentHasStatChanges = state.current?.details?.some((detail) => detail.before && detail.after);
  if (handleUncataloguedItemComponentParagraph(state, text, knownItem, currentHasStatChanges)) return true;
  if (!knownItem && state.current?.entityKind === "item" && !currentHasStatChanges) return false;
  const name = knownItem?.slug
    ? getCatalogArticleName(text, "item", state.catalog, knownItem.name || text, state.locale)
    : stripEntityMarker(text);
  const marker = getEntityMarker(text) || state.categoryMarker
    || (knownItem && state.explicitNewItemNames.has(normalizeEntityName(text)) ? "new" : null);
  const sameEntity = state.current?.entityKind === "item"
    && ((knownItem?.slug && state.current.entitySlug === knownItem.slug)
      || normalizeEntityName(state.current.entityName) === normalizeEntityName(name));
  if (!sameEntity) startRichTextEntity(state, "item", name, state.sectionName, marker);
  return true;
}

function handleSpecialRichTextItemParagraph(state, text) {
  if (isItemComponentHeading(text)) {
    state.currentSystemComponent = getItemComponentLabel(text);
    return true;
  }
  const tearMention = /tear of the goddess now a basic item/i.test(text)
    ? { entity: getCatalogEntity("item", "Tear of the Goddess", state.catalog) }
    : /слеза богини стала базовым предметом/i.test(text)
      ? { entity: getCatalogEntity("item", "Tear of the Goddess", state.catalog) }
      : null;
  if (!tearMention?.entity) return false;
  startRichTextEntity(state, "item", tearMention.entity.name, state.sectionName, state.categoryMarker);
  state.current.details.push({ label: null, before: null, after: null, text });
  return true;
}

function handleRichTextSpellParagraph(state, text) {
  if (state.current?.entityKind === "spell") return;
  const mention = findCatalogSpellMention(text, state.catalog);
  if (mention) startRichTextEntity(state, "spell", getLocalizedCatalogAlias(text, mention.alias)
    || getRussianPatchEntityName(text, "spell", state.locale, mention.entity)
    || mention.entity.name || mention.alias, state.sectionName, getEntityMarker(text) || state.categoryMarker);
}

function findCatalogItemsInText(text, catalog) {
  if (hasQualifiedItemAlias(text, catalog)) return [];
  const normalizedText = normalizeEntityName(text);
  const aliasMatches = [];
  const matches = [];
  const seen = new Set();
  const aliases = Array.from(catalog?.items?.entries() || [])
    .map(([alias, entity]) => [normalizeEntityName(alias), alias, entity])
    .filter(([alias]) => alias.length >= 4)
    .sort(([left], [right]) => right.length - left.length);
  for (const [normalizedAlias, alias, entity] of aliases) {
    let searchFrom = 0;
    while (searchFrom < normalizedText.length) {
      const start = normalizedText.indexOf(normalizedAlias, searchFrom);
      if (start < 0) break;
      const end = start + normalizedAlias.length;
      const hasWordBoundaries = (start === 0 || normalizedText[start - 1] === " ")
        && (end === normalizedText.length || normalizedText[end] === " ");
      if (hasWordBoundaries) aliasMatches.push({ alias, entity, start, end, length: normalizedAlias.length });
      searchFrom = start + 1;
    }
  }
  aliasMatches.push(...findQualifiedItemVariantMentions(text, catalog?.items));
  for (const match of aliasMatches) {
    const isNestedAlias = aliasMatches.some((other) => other.length > match.length
      && other.start <= match.start && other.end >= match.end);
    if (isNestedAlias) continue;
    const { alias, entity } = match;
    const key = entity?.slug || alias;
    if (!entity || seen.has(key)) continue;
    seen.add(key);
    matches.push({ entity, alias });
  }
  return matches.sort((left, right) => left.start - right.start);
}

function isRemovedItemCategoryHeading(value) {
  return /^(?:removed|deleted|items?\s+(?:removed|deleted)|(?:removed|deleted)\s+items?|удалено|удален[а-яё]* предмет[а-яё]*|удалён[а-яё]* предмет[а-яё]*)$/iu
    .test(cleanText(value));
}

function isRemovedItemListContext(state) {
  if (state.entityKind !== "item") return false;
  // A standalone Removed subheading creates a splitAsEntities record and the
  // heading handler restores the enclosing marker afterward. The current
  // record is the durable structural signal for that list.
  return Boolean(state.removedItemListActive || state.current?.splitAsEntities)
    || (state.categoryMarker === "removed" && isRemovedItemCategoryHeading(state.sectionName));
}

function isRemovedItemReference(value) {
  return /^(?:see\s+(?:above|below)|same\s+as\s+above|as\s+above|ditto|см\.?\s*(?:выше|ниже)|указан[оы]?\s+(?:выше|ниже))\.?$/iu
    .test(cleanText(value));
}

function isSimpleRemovedItemLabel(value) {
  const text = cleanText(value).replace(/[.;:]+$/u, "").trim();
  if (!text || text.length > 90 || /[.!?;,]/u.test(text) || /(?:→|->)/u.test(text)) return false;
  const words = text.split(/\s+/u);
  if (words.length > 9 || !/[\p{L}\p{N}]/u.test(text)) return false;
  return !/(?:^|[^\p{L}\p{N}])(?:has|have|had|is|are|was|were|been|being|can|could|will|would|should|we|they|this|that|these|those|like|because|since|while|so|no longer|has always|its|their|из-за|поскольку|поэтому|также|всегда|больше не|удаляем|убираем|стало|стал|стали)(?=$|[^\p{L}\p{N}])/iu.test(text);
}

function addRemovedCatalogItems(state, text) {
  if (!isRemovedItemListContext(state)) return false;
  if (isRemovedItemReference(text)) return true;
  const sourceName = cleanText(stripItemHeadingDecorations(text).replace(/[.;:]+$/u, "")).trim();
  const entity = getCatalogEntity("item", sourceName, state.catalog);
  // Removal lists are identity-bearing structures. A catalog name mentioned
  // inside a sentence is not evidence that the item itself was removed.
  if (!entity?.slug && (findCatalogItemsInText(text, state.catalog).length || !isSimpleRemovedItemLabel(sourceName))) return true;
  const identity = entity?.slug || normalizeEntityName(sourceName);
  if (!identity || state.removedItemSlugs.has(identity)) return true;
  state.removedItemSlugs.add(identity);
  flushRichTextChange(state);
  const alias = entity ? normalizeEntityName(sourceName) : null;
  const localizedAlias = alias ? getLocalizedCatalogAlias(text, alias) : null;
  const entityName = (localizedAlias && entity.itemVariant
    ? formatHeadingDisplayName(localizedAlias, state.locale)
    : localizedAlias)
    || (entity ? getRussianPatchEntityName(text, "item", state.locale, entity) || entity.name : sourceName);
  startRichTextEntity(state, "item", entityName, state.sectionName, "removed", entity);
  flushRichTextChange(state);
  return true;
}

function ensureRichTextListRecord(state) {
  if (state.current || state.entityKind !== 'system') return;
  state.current = {
    entityKind: state.entityKind,
    sectionName: state.sectionName,
    entityName: state.sectionName,
    changeName: null,
    details: [],
    splitAsEntities: (state.entityKind === 'item' && (/\bremoved items\b|удаленные предметы/i.test(state.sectionName) || state.categoryMarker === 'removed'))
      || (state.entityKind === 'champion' && /\bremoved champions\b|удаленные чемпионы/i.test(state.sectionName)),
  };
}

function getRichTextListDetailParts(state, node, text, $) {
  const namedStats = state.entityKind === 'system' ? splitNamedStatHeading(text) : null;
  if (namedStats?.component) state.currentListComponent = namedStats.component;
  if (state.entityKind === 'system' && state.currentListComponent && !namedStats
    && !/^(?:здоровье|сила атаки|броня|сопротивление магии)\s*:/i.test(text)) {
    state.currentListComponent = null;
  }
  const detailText = namedStats?.text || text;
  const components = state.entityKind === 'system'
    ? nestedListComponents(node, $)
    : state.entityKind === 'item' ? nestedItemListComponents(node, $) : [];
  const component = components.length
    ? components.join(' — ')
    : namedStats?.component || state.currentListComponent || state.currentSystemComponent;
  return { detailText, component };
}

function appendRichTextListDetails(state, detailText, component) {
  const details = parseRichTextDetail(detailText).map((detail) => (
    component ? { ...detail, component } : detail
  ));
  appendUniqueRichTextDetails(state.current, details);
}

function appendUniqueRichTextDetails(change, details) {
  for (const detail of details) {
    if (!detail.label && !detail.before && !detail.after
      && normalizeEntityName(detail.text) === normalizeEntityName(change.entityName)) continue;
    const duplicate = change.details.find((existing) => existing.label === detail.label
      && existing.before === detail.before && existing.after === detail.after
      && ((existing.before && existing.after) || existing.text === detail.text)
      && existing.component === detail.component);
    if (duplicate) {
      if (detail.component) duplicate.component = detail.component;
    } else {
      change.details.push(detail);
    }
  }
}

function trimAppendedItemHeading(detail, catalog) {
  if (!detail.after || !detail.before) return { detail, entityName: null };
  const aliases = Array.from(catalog?.items?.keys() || [])
    .map(normalizeEntityName)
    .filter((alias) => alias.split(" ").length > 1)
    .sort((left, right) => right.length - left.length);
  for (const alias of aliases) {
    const words = alias.split(" ").map(escapeRegex).join("[^\\p{L}\\p{N}]*");
    const match = detail.after.match(new RegExp(`^(.*?)${words}$`, "iu"));
    if (!match?.[1] || !/\d/.test(match[1])) continue;
    const value = cleanText(match[1]);
    if (!/^[\d\s.,%/+()\-–]+$/.test(value)) continue;
    const entityName = cleanText(detail.after.slice(match[1].length));
    return {
      detail: { ...detail, after: value, text: `${detail.label}: ${detail.before} → ${value}` },
      entityName,
    };
  }
  return { detail, entityName: null };
}

function addRichTextListItem(state, node, text, $) {
  const hasNestedLists = $(node).children("ul,ol").length > 0;
  if (isRemovedItemListContext(state)) {
    // Riot's removed-items markup sometimes wraps explanatory prose around an
    // explicit nested list of item names. Only the leaf entries are identities.
    if (hasNestedLists) return;
    addRemovedCatalogItems(state, text);
    return;
  }
  if (state.entityKind === "item" && hasNestedLists
    && isItemListComponentHeading(text)) return;
  if (!state.current && state.entityKind === "item"
    && state.categoryMarker === "returning"
    && !/^(?:see above|same as above|см\.? выше|указан[оы]? выше)$/i.test(text)
    && text.length <= 100 && !/(?:→|->)/.test(text)) {
    const sourceName = cleanText(stripEntityMarker(text).replace(/[.;:]+$/u, ""));
    const mention = findRichTextItemMention(sourceName, state.catalog);
    const item = mention?.entity || getCatalogEntity("item", sourceName, state.catalog);
    const name = getLocalizedCatalogAlias(sourceName, mention?.alias)
      || getRussianPatchEntityName(sourceName, "item", state.locale, item)
      || item?.name
      || formatHeadingDisplayName(sourceName, state.locale);
    startRichTextEntity(state, "item", name, state.sectionName, state.categoryMarker);
    if (state.categoryMarker === "returning") state.current.details.push({
      label: null,
      before: null,
      after: null,
      text: state.locale === "ru-ru" ? "Возвращен в игру." : "Returned to the game.",
    });
    flushRichTextChange(state);
    return;
  }
  ensureRichTextListRecord(state);
  if (!state.current) return;
  const { detailText, component } = getRichTextListDetailParts(state, node, text, $);
  appendRichTextListDetails(state, detailText, component);
}
function addRichTextParagraphDetails(state, text) {
  if (!state.current || !state.entityKind
    || (!/(?:→|->)/.test(text) && !hasStandaloneNumericChangeStatement(text))) return;
  const details = parseRichTextDetail(text).map((detail) => (
    state.currentSystemComponent ? { ...detail, component: state.currentSystemComponent } : detail
  ));
  appendUniqueRichTextDetails(state.current, details);
}

function hasStandaloneNumericChangeStatement(value) {
  const text = cleanText(value);
  if (!text || /(?:→|->)/.test(text) || !/\d/u.test(text)) return false;
  // Examples that explain a formula can mention a numeric increase without
  // describing a patch delta (for example, attack-speed growth by level).
  if (/[=×÷]/u.test(text) && /(?:\bfor example\b|\be\.g\.|например|к примеру)/iu.test(text)) return false;
  const amount = "[+\\-−]?\\s*\\d+(?:[.,]\\d+)?\\s*%?";
  const englishChange = new RegExp(
    `\\b(?:reduc\\p{L}*|decreas\\p{L}*|lower\\p{L}*|increas\\p{L}*|rais\\p{L}*|boost\\p{L}*|chang\\p{L}*|set|limit\\p{L}*)\\b[^.!?…。]{0,100}\\b(?:to|by)\\s*${amount}`,
    "iu",
  );
  const russianChange = new RegExp(
    `(?:сниж|уменьш|пониж|повыш|увелич|сократ|измен|огранич|усил)\\p{L}*[^.!?…。]{0,100}(?:^|\\s)(?:до|на)\\s*${amount}`,
    "iu",
  );
  return englishChange.test(text) || russianChange.test(text);
}

function handleRichTextItemParagraphDetails(state, text) {
  if (/^(?:energized items|энергизированные предметы)$/i.test(text)) {
    flushRichTextChange(state);
    state.currentSystemComponent = text;
    return;
  }
  handleRichTextItemParagraph(state, text);
  if (/(?:details?|подробност).{0,100}(?:physical vamp|physical omnivamp|физическ.{0,30}(?:вытягив|вампир)|omnivamp|вампир).{0,100}(?:below|following section|ниже|разделе ниже)/i.test(text)) return;
  if (state.current?.entityKind === "item" && !/(?:→|->)/.test(text)
    && !getCatalogEntity("item", text, state.catalog)) {
    appendUniqueRichTextDetails(state.current, [{ label: null, before: null, after: null, text }]);
  }
  if (state.current && /(?:new item|новый предмет)/i.test(text)
    && state.explicitNewItemNames.has(normalizeEntityName(state.current.entityName))) {
    state.current.changeName = "new";
  }
}

function handleRichTextRuneParagraphDetails(state, text) {
  if (state.entityKind !== "rune" || !state.current || !state.currentNode || !state.$ || /(?:→|->)/.test(text)) return false;
  const followingBlocks = state.$(state.currentNode).nextAll().toArray();
  let hasFollowingNumericList = false;
  for (const node of followingBlocks) {
    const tag = String(node.tagName || "").toLowerCase();
    if (/^h[1-6]$/u.test(tag)) break;
    if (!["ul", "ol"].includes(tag)) continue;
    hasFollowingNumericList = state.$(node).find("li").toArray()
      .some((listItem) => /(?:→|->)/.test(directListItemText(listItem, state.$)));
    break;
  }
  if (!hasFollowingNumericList) return false;
  appendUniqueRichTextDetails(state.current, [{
    label: null,
    before: null,
    after: null,
    text,
    ...(state.currentSystemComponent ? { component: state.currentSystemComponent } : {}),
  }]);
  return true;
}

function handleRichTextSystemSpellParagraph(state, text) {
  if (state.entityKind !== "system" || !/^(?:smite|кара)$/i.test(stripEntityMarker(text))) return false;
  const spell = getCatalogEntity("spell", text, state.catalog) || findCatalogSpellMention(text, state.catalog)?.entity;
  if (!spell) return false;
  flushRichTextChange(state);
  state.entityKind = "spell";
  state.categoryMarker = null;
  startRichTextEntity(state, "spell", getCatalogArticleName(text, "spell", state.catalog, spell.name || text), state.sectionName);
  return true;
}

function handleRichTextSystemHeadingParagraph(state, text) {
  if (state.entityKind !== "system") return false;
  const knownSystemSection = normalizeEntityName(text);
  if (["обновление системы очков чемпиона", "бонус приоритетнои роли"].includes(knownSystemSection)) {
    startRichTextEntity(state, "system", text, state.sectionName);
    return true;
  }
  if (text.length > 110 || /[.!?]$/.test(text)) return false;
  if (!/(?:adjustments?|changes?|activity rules?|правки|изменени|правил|корректировк)/i.test(text)) return false;
  startRichTextEntity(state, "system", text, state.sectionName);
  return true;
}

function handleRichTextKeyItemRecommendationParagraph(state, text) {
  if (state.entityKind !== "system"
    || !["in game key item recommendations", "внутриигровые рекомендации по ключевым предметам"]
      .includes(normalizeEntityName(state.current?.entityName))
    || /(?:→|->)/.test(text)) return false;
  state.current.details.push({ label: null, before: null, after: null, text });
  return true;
}

function handleRichTextTrainingCampParagraph(state, text) {
  if (state.entityKind !== "system" || normalizeEntityName(state.current?.entityName) !== "training camp") return false;
  appendUniqueRichTextDetails(state.current, [{ label: null, before: null, after: null, text }]);
  return true;
}

function handleRichTextMinionVisual(state, text) {
  if (!/^миньон[-\s]/i.test(state.current?.entityName || "")) return false;
  const nonEmojiText = text.replace(/\s/gu, "").replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\u200d/gu, "").replace(/\ufe0f/gu, "");
  if (nonEmojiText) return false;
  return true;
}

function handleRichTextParagraph(state, text) {
  if (handleRichTextMinionVisual(state, text)) return;
  if (handleRichTextSystemComponentParagraph(state, text)) return;
  if (handleRichTextSystemSpellParagraph(state, text)) return;
  if (handleRichTextKeyItemRecommendationParagraph(state, text)) return;
  if (handleRichTextTrainingCampParagraph(state, text)) return;
  if (handleRichTextSystemHeadingParagraph(state, text)) return;
  if (handleTopLevelSystemParagraph(state, text)) return;
  if (state.entityKind === "item" && handleSpecialRichTextItemParagraph(state, text)) return;
  if (state.entityKind === "item" && handleRichTextVariantComponentParagraph(state, text)) return;
  if (state.entityKind) {
    const handledAsEntity = handleRichTextParagraphEntity(state, text);
    if (handledAsEntity) return;
  }
  if (handleRichTextRuneParagraphDetails(state, text)) return;
  if (state.entityKind === "item") handleRichTextItemParagraphDetails(state, text);
  if (state.entityKind === "spell") handleRichTextSpellParagraph(state, text);
  if (state.entityKind === "item" && isItemComponentHeading(text)) {
    state.currentSystemComponent = getItemComponentLabel(text);
    return;
  }
  addRichTextParagraphDetails(state, text);
}

function handleRichTextVariantComponentParagraph(state, text) {
  if (!state.current || state.current.entityKind !== "item" || !state.currentNode || !state.$) return false;
  const variant = resolveQualifiedItemVariantBySlug(state.current.entitySlug, state.catalog?.items, state.current.entityName);
  if (!variant) return false;
  const item = getCatalogEntity("item", text, state.catalog);
  if (item?.slug !== variant.baseItemSlug || hasRichTextItemChangeAhead(state.currentNode, state.$, state.catalog)) return false;
  state.currentSystemComponent = formatHeadingDisplayName(stripEntityMarker(text).replace(/[:：]\s*$/, ""), state.locale);
  state.currentListComponent = null;
  return true;
}

function handleRichTextSystemComponentParagraph(state, text) {
  if (state.entityKind !== "system") return false;
  if (/^(?:turret plating|башенные пластины)$/i.test(text)) {
    state.currentSystemComponent = text;
  } else if (/^(?:показатели|новые особенности)\b/i.test(text)) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
  } else {
    return false;
  }
  state.currentListComponent = null;
  return true;
}

function handleTopLevelSystemParagraph(state, text) {
  const topLevelSystem = /^(?:system|игровые системы)$/i.test(cleanText(state.sectionName || ""));
  if (!topLevelSystem || state.current?.entityKind !== "system" || !text || /(?:→|->)/.test(text)) return false;
  appendUniqueRichTextDetails(state.current, [{ label: null, before: null, after: null, text }]);
  return true;
}

function handleRichTextNode(state, node, text, $, tag, hasNestedHeading = false) {
  if (handleRichTextHeadingNode(state, text, tag, hasNestedHeading)) return;
  if (state.ignoredGameMode) return;
  if (tag === "p" && state.entityKind === "item" && isItemComponentHeading(text)) {
    state.currentSystemComponent = getItemComponentLabel(text);
    return;
  }
  if (tag === "p" && state.entityKind === "item"
    && handleRichTextItemStatParagraph(state, node, text, $)) return;
  if (tag === "p" && /(?:ослабим большинство рун|руны стали играть чересчур важную роль|broad nerfs across most runes|runes have become too impactful)/i.test(text)) {
    flushRichTextChange(state);
    state.entityKind = "rune";
    state.sectionName = /runes/i.test(text) && !/рун/i.test(text) ? "Rune Adjustments" : "Изменения рун";
    state.categoryMarker = null;
    state.currentSystemComponent = null;
    state.currentListComponent = null;
    return;
  }
  if (tag === "p") {
    state.currentNode = node;
    state.$ = $;
    handleRichTextParagraph(state, text);
    state.currentNode = null;
    state.$ = null;
  }
  if (tag === "li" && state.entityKind) addRichTextListItem(state, node, patchArticleNodeText(node, $), $);
}

function handleRichTextItemStatHeading(state, text, tag) {
  if (!["h4", "h5"].includes(tag) || state.entityKind !== "item" || !state.current || !/(?:→|->)/.test(text)) return false;
  const detailComponent = state.currentSystemComponent;
  const isBuildPath = /^(?:build path|recipe|путь сборки|рецепт)$/i.test(cleanText(detailComponent));
  const parsedDetails = parseRichTextDetail(text).map((detail) => (
    isBuildPath ? { detail, entityName: null } : trimAppendedItemHeading(detail, state.catalog)
  ));
  const details = parsedDetails.map(({ detail }) => (
    detailComponent ? { ...detail, component: detailComponent } : detail
  ));
  if (!details.some((detail) => detail.before && detail.after)) return false;
  appendUniqueRichTextDetails(state.current, details);
  const trailingItemName = parsedDetails.find((entry) => entry.entityName)?.entityName;
  const trailingItem = trailingItemName && getCatalogEntity("item", trailingItemName, state.catalog);
  if (trailingItem?.slug && trailingItem.slug !== state.current.entitySlug) {
    const localizedName = getCatalogArticleName(trailingItemName, "item", state.catalog, trailingItem.name || trailingItemName, state.locale);
    startRichTextEntity(state, "item", localizedName, state.sectionName);
  }
  return true;
}

function handleRichTextHeadingNode(state, text, tag, hasNestedHeading = false) {
  if (tag === "h1" || tag === "h2") {
    handleRichTextTopHeading(state, text, tag, hasNestedHeading);
    return true;
  }
  if (!["h3", "h4", "h5", "h6"].includes(tag)) return false;
  const level = Number(tag.slice(1));
  const isSameLevelModeItemCategory = state.ignoredGameModeLevel === level
    && getCategoryHeading(text) === "item";
  if (!isSameLevelModeItemCategory) {
    state.ignoredGameModeLevel = advanceIgnoredGameModeScope(text, level, state.ignoredGameModeLevel);
  }
  state.ignoredGameMode = state.ignoredGameModeLevel !== null;
  if (!state.ignoredGameMode && (isGameModeHeading(text)
    || /game mode changes|игровых? режим|режим приключени|арена|aaa\s*aram|отвязное безумие/i.test(text))) {
    flushRichTextChange(state);
    state.ignoredGameMode = true;
    state.ignoredGameModeLevel = level;
    state.entityKind = null;
    return true;
  }
  if (state.ignoredGameMode && ["h3", "h4", "h5"].includes(tag)
    && /^(?:in-game key item recommendations|summoner(?:'|’)s rift|smite adjustments?|training camp|ущелье призывателей|внутриигровые рекомендации по ключевым предметам|изменения кары|тренировочная площадка)$/i.test(text)) {
    state.ignoredGameMode = false;
    state.entityKind = getCategoryHeading(text) || "system";
    state.sectionName = text;
    state.categoryMarker = null;
    state.categoryHeadingLevel = Number(tag.slice(1));
    state.currentSystemComponent = null;
    state.currentListComponent = null;
    startRichTextEntity(state, "system", text, text);
    return true;
  }
  if (handleRichTextItemStatHeading(state, text, tag)) return true;
  const continuesItem = state.entityKind === "item" && isItemComponentHeading(text);
  if (tag === "h3" && state.current && !continuesItem) flushRichTextChange(state);
  if (!state.ignoredGameMode) handleRichTextSubheading(state, text, tag, hasNestedHeading);
  return true;
}

function parseRichTextChanges(blade, catalog, explicitNewItemNames = new Set(), explicitNewRuneNames = new Set(), locale) {
  if (isLoadoutAdjustmentsBlade(blade)) return parseLoadoutAdjustmentChanges(blade, catalog, locale);
  const html = extractRichText(blade);
  const $ = load(`<div>${html}</div>`, null, false);
  const blocks = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray().filter((node) => {
    const tag = String(node.tagName || "").toLowerCase();
    const element = $(node);
    return !(tag === "p" && element.parents("li").length);
  });
  const fragmentHeading = cleanText(blade?.fragmentId || "").replace(/[-_]+/g, " ");
  const fragmentCategory = getCategoryHeading(fragmentHeading) || getArticleChangeKind(fragmentHeading);
  const state = createRichTextChangeState(fragmentCategory ? formatHeadingDisplayName(fragmentHeading, locale) : "", catalog, explicitNewItemNames, explicitNewRuneNames, locale);
  if (fragmentCategory) {
    state.entityKind = fragmentCategory;
    state.categoryHeadingLevel = 0;
  }
  for (const [index, node] of blocks.entries()) {
    const text = patchArticleNodeText(node, $);
    if (!text) continue;
    const tag = String(node.tagName || "").toLowerCase();
    const headingLevel = Number(tag.slice(1));
    const hasNestedHeading = /^h[1-6]$/.test(tag)
      && headingHasNestedHeading(blocks, index, headingLevel);
    if (/^h[1-6]$/.test(tag)) {
      const headingKind = getCategoryHeading(text) || getArticleChangeKind(text);
      const knownChampion = getCatalogEntity("champion", text, catalog)
        || findCatalogChampionHeading(text, catalog)?.entity;
      if (state.genericSystemWrapperLevel !== null && headingLevel <= state.genericSystemWrapperLevel) {
        state.genericSystemWrapperLevel = null;
      }
      if (headingKind) state.genericSystemWrapperLevel = null;
      else if (state.entityKind === "system"
        && state.categoryHeadingLevel !== null
        && headingLevel > state.categoryHeadingLevel
        && !knownChampion) {
        state.genericSystemWrapperLevel = headingLevel;
      }
    }
    if (/^h[3-6]$/.test(tag)
      && state.entityKind === "system"
      && !state.ignoredGameMode
      && state.genericSystemWrapperLevel !== null
      && headingLevel > state.genericSystemWrapperLevel) {
      const champion = getCatalogEntity("champion", text, catalog)
        || findCatalogChampionHeading(text, catalog)?.entity;
      if (champion?.slug && hasInlineChampionChangeAhead(blocks, index, headingLevel, catalog, $)) {
        // Older Riot rich-text templates place a champion's changes under a
        // generic system heading (for example, Hotfix > Camille). A known
        // champion heading followed by structured numeric deltas is stronger
        // evidence than the parent section's generic system classification.
        flushRichTextChange(state);
        state.entityKind = "champion";
        state.categoryMarker = null;
        state.genericSystemWrapperLevel = null;
        state.currentSystemComponent = null;
        state.currentListComponent = null;
      }
    }
    const isStructuralCategoryHeading = /^h[1-2]$/.test(tag)
      && getCategoryHeading(text) === "system"
      && headingHasFollowingEntityCategory(blocks, index, $, headingLevel);
    if (/^h[3-6]$/.test(tag)
      && state.entityKind === "champion" && !state.ignoredGameMode
      && headingLevel > (state.categoryHeadingLevel ?? 0)
      && !getCategoryHeading(text)
      && isStructuralChampionHeading(blocks, index, $, catalog, state.currentEntityHeadingLevel)) {
      handleRichTextChampionHeading(state, text, true);
      state.currentEntityHeadingLevel = headingLevel;
      continue;
    }
    const previousEntity = state.current;
    handleRichTextNode(state, node, text, $, tag, hasNestedHeading);
    if (/^h[1-6]$/.test(tag) && state.current?.entityKind === "champion" && state.current !== previousEntity) {
      state.currentEntityHeadingLevel = headingLevel;
    }
    if (isStructuralCategoryHeading) state.entityKind = null;
  }
  flushRichTextChange(state);
  return state.records;
}

function isLoadoutAdjustmentsBlade(blade) {
  return /^(?:loadout adjustments|изменения сборки)$/i.test(cleanText(blade?.fragmentId || ""));
}

function parseLoadoutAdjustmentChanges(blade, catalog, locale) {
  const html = extractRichText(blade);
  const $ = load(`<div>${html}</div>`, null, false);
  const nodes = $.root().children().first().find("p,li").toArray().filter((node) => {
    const element = $(node);
    return !(String(node.tagName || "").toLowerCase() === "li" && element.find("li").length)
      && !(String(node.tagName || "").toLowerCase() === "p" && element.parents("li").length);
  });
  const changes = [];
  const russian = locale === "ru-ru";
  let champion = null;
  let current = null;

  for (const node of nodes) {
    const tag = String(node.tagName || "").toLowerCase();
    const text = cleanText($(node).text());
    if (tag === "p") {
      const knownChampion = text ? getCatalogEntity("champion", text, catalog) : null;
      if (knownChampion) {
        if (current?.details.length) changes.push(current);
        champion = { ...knownChampion, sourceName: text };
        current = null;
      } else if (/^(?:loadout adjustments|изменения сборки)$/i.test(text) && champion) {
        current = {
          entityKind: "champion",
          entitySlug: champion.slug,
          entityName: russian ? champion.sourceName : champion.name,
          sectionName: russian ? "Изменения чемпионов" : "CHAMPION CHANGES",
          changeName: russian ? "Изменения сборки" : "Loadout Adjustments",
          details: [],
        };
      }
      continue;
    }
    if (tag === "li" && current && text) {
      current.details.push({ label: null, before: null, after: null, text });
    }
  }

  if (current?.details.length) changes.push(current);
  return changes;
}

function parseChampionChanges(blade) {
  const entries = Array.isArray(blade.characters) ? blade.characters : [];
  return entries.flatMap((entry) => {
    const character = entry?.character || entry || {};
    const entityName = cleanText(character.name || entry?.name || entry?.title);
    if (!entityName) return [];
    const changes = (Array.isArray(entry?.changes) ? entry.changes : []).flatMap((change) => {
      const title = cleanText(change?.title || "General");
      const detailsHtml = sanitizeRichText(change?.description?.body || change?.descriptionText || "");
      const details = extractStatChanges(detailsHtml);
      const changeDetails = isChampionBaseStatsHeading(title)
        ? details.filter((detail) => (detail.before && detail.after)
          || /^\[(?:new|added|removed|deleted|новое|добавлено|удал[её]но)\]/i.test(detail.text))
        : details;
      if (!changeDetails.length) return [];
      return [{
        entityKind: "champion",
        entityName,
        sourceImageUrl: safeRiotImageUrl(character.media?.url),
        sectionName: "Champions",
        changeName: title,
        details: changeDetails,
      }];
    });
    return changes;
  });
}

function getAccordionGroupBody(group) {
  if (typeof group?.content === "string") return group.content;
  return group?.content?.body || group?.body || group?.html || "";
}

function getAccordionRootText(root, $) {
  return cleanText($(root).contents().toArray()
    .filter((node) => node.type === "text" || (node.type === "tag" && ["p", "span", "strong", "em"].includes(String(node.tagName || "").toLowerCase())))
    .map((node) => $(node).text())
    .join(" "));
}

function findAccordionEntity(text, catalog) {
  for (const kind of ["item", "rune", "spell"]) {
    const mention = findCatalogLead(kind, text, catalog);
    if (mention) return { kind, ...mention };
  }
  const champion = findCatalogChampionHeading(text, catalog);
  return champion ? { kind: "champion", ...champion } : null;
}

function findExactAccordionGroupEntity(label, catalog) {
  const alias = normalizeEntityName(stripEntityMarker(label));
  if (!alias) return null;

  for (const kind of ["champion", "item", "rune", "spell"]) {
    const entity = catalog?.[`${kind}s`]?.get(alias);
    if (entity) return { kind, entity, alias };
  }

  const historicalRune = PATCH_NOTE_HISTORICAL_RUNE_IDENTITIES.find(({ aliases }) => (
    aliases.some((candidate) => normalizeEntityName(candidate) === alias)
  ));
  return historicalRune ? { kind: "rune", entity: historicalRune, alias } : null;
}

function collectAccordionGroupDetails(root, $) {
  const details = [];
  const visit = (node) => {
    if (node.type === "text") {
      const text = cleanText(node.data);
      if (text) details.push(...getAccordionDetail(text));
      return;
    }
    if (node.type !== "tag") return;

    const tag = String(node.tagName || "").toLowerCase();
    if (tag === "p") {
      details.push(...getAccordionDetail(nodeTextWithBreaks($, node)));
    } else if (tag === "li") {
      const ownText = directListItemText(node, $);
      if (ownText) details.push(...getAccordionDetail(ownText));
      $(node).children("ul,ol").contents().each((_, child) => visit(child));
    } else if (tag === "ul" || tag === "ol") {
      $(node).children("li").each((_, item) => visit(item));
    } else {
      $(node).contents().each((_, child) => visit(child));
    }
  };
  $(root).contents().each((_, node) => visit(node));
  return details;
}

function getAccordionEntitySourceName(text, mention) {
  return getLocalizedCatalogAlias(text, mention.alias)
    || cleanText(text).split(/\s*:\s*(?=.*(?:→|->))/u, 1)[0]
    || cleanText(text);
}

function getAccordionEntityTail(text, sourceName) {
  return cleanText(text).slice(sourceName.length).replace(/^[\s:：–—-]+/u, "").trim();
}

function getAccordionDetail(text) {
  const detail = cleanText(text);
  return detail ? parseRichTextDetail(detail) : [];
}

function getAccordionNestedDetails(node, $) {
  return $(node).find("li").toArray().flatMap((nested) => getAccordionDetail(directListItemText(nested, $)));
}

function buildAccordionEntityChange({ kind, entity, alias }, sourceText, sectionName, marker, catalog, locale, details) {
  const sourceName = getAccordionEntitySourceName(sourceText, { entity, alias });
  const fallbackName = cleanText(sourceName || sourceText);
  const entityName = kind === "champion"
    ? getLocalizedChampionHeadingName(sourceText, { alias, entity }, entity, fallbackName, locale)
    : getCatalogArticleName(sourceText, kind, catalog, fallbackName, locale);
  const row = {
    entityKind: kind,
    sectionName,
    entityName: stripEntityMarker(entityName),
    ...(entity?.slug ? { entitySlug: entity.slug } : {}),
    changeName: getEntityMarker(sourceText) || marker || null,
    details: [...getAccordionDetail(getAccordionEntityTail(sourceText, sourceName)), ...details],
  };
  return row;
}

function getAccordionEntryTitle(text) {
  const value = cleanText(text);
  const arrow = value.search(/(?:→|->)/u);
  const colon = value.indexOf(":");
  if (colon > 0 && arrow >= 0 && colon < arrow) return cleanText(value.slice(0, colon));
  return value;
}

function parseAccordionFallbackEntry(text, kind, sectionName, marker) {
  const sourceText = cleanText(text);
  const entityName = getAccordionEntryTitle(sourceText);
  const detailText = entityName === sourceText
    ? ""
    : sourceText.slice(sourceText.indexOf(":") + 1).trim();
  return {
    entityKind: kind,
    sectionName,
    entityName: stripEntityMarker(entityName),
    changeName: getEntityMarker(sourceText) || marker || null,
    details: getAccordionDetail(detailText),
  };
}

function parseAccordionHeadingEntities(root, $, sectionName, marker, catalog, locale) {
  const children = root.children().toArray();
  const headings = children.filter((node) => /^h[1-6]$/i.test(String(node.tagName || "")));
  const recognized = headings.flatMap((node) => {
    const text = cleanText($(node).text());
    const mention = findAccordionEntity(text, catalog);
    return mention ? [{ node, text, mention, level: Number(String(node.tagName).slice(1)) }] : [];
  });
  if (!recognized.length) return null;

  const headingKinds = new Map();
  for (const entry of recognized) {
    const key = `${entry.mention.kind}:${entry.level}`;
    headingKinds.set(key, (headingKinds.get(key) || 0) + 1);
  }
  const dominantKey = [...headingKinds.entries()].sort((left, right) => right[1] - left[1])[0][0];
  const [inferredKind, levelText] = dominantKey.split(":");
  const entityLevel = Number(levelText);
  const explicitGroupKind = getCategoryHeading(sectionName) || getArticleChangeKind(sectionName);
  const fallbackKind = inferredKind === "champion" && !explicitGroupKind ? "system" : inferredKind;
  const changes = [];
  let current = null;
  let component = null;
  const flush = () => {
    if (current && (current.details.length || current.changeName)) changes.push(current);
    current = null;
    component = null;
  };

  for (const node of children) {
    const tag = String(node.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const text = cleanText($(node).text());
      if (level < entityLevel) {
        flush();
        continue;
      }
      if (level > entityLevel) {
        if (current) component = text;
        continue;
      }

      flush();
      const mention = recognized.find((entry) => entry.node === node)?.mention || null;
      const entityName = mention
        ? mention.kind === "champion"
          ? getLocalizedChampionHeadingName(text, mention, mention.entity, text, locale)
          : getCatalogArticleName(text, mention.kind, catalog, text, locale)
        : stripEntityMarker(text);
      const headingCategory = mention ? null : getCategoryHeading(text);
      current = {
        entityKind: mention?.kind || (headingCategory === "system" ? "system" : fallbackKind),
        sectionName,
        entityName: stripEntityMarker(entityName),
        ...(mention?.entity?.slug ? { entitySlug: mention.entity.slug } : {}),
        changeName: getEntityMarker(text) || marker || null,
        details: [],
      };
      continue;
    }

    if (!current) continue;
    if (["ul", "ol"].includes(tag)) {
      for (const item of $(node).children("li").toArray()) {
        const detail = directListItemText(item, $);
        if (detail) {
          current.details.push(...getAccordionDetail(detail).map((row) => (
            component ? { ...row, component } : row
          )));
        }
        current.details.push(...getAccordionNestedDetails(item, $));
      }
    } else if (tag === "p") {
      const detail = cleanText($(node).text());
      if (detail) {
        current.details.push(...getAccordionDetail(detail).map((row) => (
          component ? { ...row, component } : row
        )));
      }
    }
  }

  flush();
  return changes;
}

function classifyAccordionEntries(root, $, catalog) {
  return root.children("ul,ol").children("li").toArray()
    .map((node) => {
      const text = directListItemText(node, $);
      return { node, text, mention: findAccordionEntity(text, catalog) };
    })
    .filter(({ text }) => Boolean(text));
}

function inferAccordionEntryKind(sectionName, classified) {
  const groupKind = getCategoryHeading(sectionName) || getArticleChangeKind(sectionName);
  if (groupKind) return groupKind;
  const counts = new Map();
  for (const { mention } of classified) {
    if (mention) counts.set(mention.kind, (counts.get(mention.kind) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function parseAccordionEntries(classified, inferredKind, sectionName, marker, catalog, locale, $) {
  const changes = [];
  const fallbackDetails = [];
  for (const { node, text, mention } of classified) {
    if (mention) {
      const change = buildAccordionEntityChange(
        mention, text, sectionName, marker, catalog, locale, getAccordionNestedDetails(node, $),
      );
      if (change.details.length || change.changeName) changes.push(change);
    } else if (inferredKind && inferredKind !== "system") {
      const change = parseAccordionFallbackEntry(text, inferredKind, sectionName, marker);
      change.details.push(...getAccordionNestedDetails(node, $));
      if (change.details.length || change.changeName) changes.push(change);
    } else {
      fallbackDetails.push(...getAccordionDetail(text), ...getAccordionNestedDetails(node, $));
    }
  }
  return { changes, fallbackDetails };
}

function collectAccordionFallbackDetails(root, rootText, $, fallbackDetails) {
  if (rootText) fallbackDetails.push(...getAccordionDetail(rootText));
  fallbackDetails.push(...root.find("li").toArray()
    .filter((node) => !$(node).parents("li").length)
    .flatMap((node) => [
      ...getAccordionDetail(directListItemText(node, $)),
      ...getAccordionNestedDetails(node, $),
    ]));
  fallbackDetails.push(...root.children("p").toArray().flatMap((node) => getAccordionDetail($(node).text())));
}

function parseRichTextAccordionGroup(group, catalog, locale) {
  const html = getAccordionGroupBody(group);
  if (!html) return [];
  const sectionName = cleanText(group?.label || "Accordion changes");
  const marker = getCategoryMarker(sectionName);
  const $ = load(html);
  const root = $("body").first().length ? $("body").first() : $.root().children().first();
  const rootText = getAccordionRootText(root, $);
  const rootMention = rootText ? findAccordionEntity(rootText, catalog) : null;
  if (rootMention) {
    const change = buildAccordionEntityChange(
      rootMention, rootText, sectionName, marker, catalog, locale, getAccordionNestedDetails(root, $),
    );
    return change.details.length || change.changeName ? [change] : [];
  }

  const labelEntity = findExactAccordionGroupEntity(sectionName, catalog);
  const hasNestedEntityHeadings = root.find("h1,h2,h3,h4,h5,h6").length > 0;
  if (labelEntity && !hasNestedEntityHeadings) {
    const details = collectAccordionGroupDetails(root, $);
    if (details.length) {
      return [buildAccordionEntityChange(
        labelEntity, sectionName, sectionName, marker, catalog, locale, details,
      )];
    }
  }

  const headingChanges = parseAccordionHeadingEntities(root, $, sectionName, marker, catalog, locale);
  if (headingChanges) return headingChanges;

  const classified = classifyAccordionEntries(root, $, catalog);
  const inferredKind = inferAccordionEntryKind(sectionName, classified);
  const { changes, fallbackDetails } = parseAccordionEntries(classified, inferredKind, sectionName, marker, catalog, locale, $);
  if (!classified.length) collectAccordionFallbackDetails(root, rootText, $, fallbackDetails);
  if (fallbackDetails.length) {
    changes.push({
      entityKind: "system",
      sectionName,
      entityName: sectionName,
      changeName: marker || null,
      details: fallbackDetails,
    });
  }
  return changes;
}

function parseRichTextAccordionChanges(blade, catalog, locale) {
  const groups = Array.isArray(blade?.groups) ? blade.groups : [];
  return groups.flatMap((group) => parseRichTextAccordionGroup(group, catalog, locale));
}

function parseStructuredChanges(blades, catalog, locale) {
  const explicitNewItemNames = collectExplicitNewItemNames(blades, catalog);
  const explicitNewRuneNames = collectExplicitNewRuneNames(blades, catalog);
  return (Array.isArray(blades) ? blades : []).flatMap((blade) => {
    if (blade?.type === "characterChanges") return parseChampionChanges(blade);
    if (blade?.type === "articleRichTextAccordion") return parseRichTextAccordionChanges(blade, catalog, locale);
    if (blade?.type === "articleRichText" || blade?.type === "patchNotesRichText") {
      return [
        ...parseRichTextChanges(blade, catalog, explicitNewItemNames, explicitNewRuneNames, locale),
        ...parseModeScopedChanges(blade, catalog, locale),
      ];
    }
    return [];
  });
}

function hasGameModeChangesHeading(blades) {
  return (Array.isArray(blades) ? blades : []).some((blade) => {
    if (!/^(?:articleRichText|patchNotesRichText)$/.test(blade?.type || "")) return false;
    const html = extractRichText(blade);
    if (!html) return false;
    const $ = load(`<div>${html}</div>`, null, false);
    return $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray()
      .some((node) => isGameModeChangesHeading(cleanText($(node).text())));
  });
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueChampions(catalog) {
  const supplementalAliases = {
    jayce: ["Джейс"],
    kaisa: ["Kai'Sa", "Kai’Sa", "Кай'Са", "Кай’Са"],
    khazix: ["Ка'Зикс", "Ка’Зикс"],
    rakan: ["Рэйкан"],
    xayah: ["Шая"],
  };
  const champions = new Map();
  for (const champion of catalog?.champions?.values() || []) {
    if (champion?.slug) champions.set(champion.slug, champion);
  }
  for (const champion of [
    { slug: "hwei", name: "Хвэй", aliases: ["Хвэй", "Hwei"] },
    { slug: "yunara", name: "Юнара", aliases: ["Юнара", "Yunara"] },
    { slug: "skarner", name: "Скарнер", aliases: ["Скарнер", "Skarner"] },
    { slug: "taliyah", name: "Талия", aliases: ["Талия", "Taliyah"] },
    { slug: "aurora", name: "Аврора", aliases: ["Аврора", "Aurora"] },
    { slug: "kaisa", name: "Кай'Са", aliases: ["Kai'Sa", "Kai’Sa", "Кай'Са", "Кай’Са"] },
    { slug: "norra", name: "Норра", aliases: ["Norra", "Норра"] },
  ]) {
    if (!champions.has(champion.slug)) champions.set(champion.slug, champion);
  }
  return Array.from(champions.values()).map((champion) => ({
    ...champion,
    aliases: Array.from(new Set([
      champion.name,
      ...Object.values(champion.nameLocalizations || {}),
      ...(champion.aliases || []),
      ...(supplementalAliases[champion.slug] || []),
      ...Array.from(catalog.champions.entries())
        .filter(([, candidate]) => candidate.slug === champion.slug)
        .map(([alias]) => alias),
    ].filter(Boolean))).sort((left, right) => right.length - left.length),
  }));
}

function extractFollowingSkinName(source) {
  if (/^\s*(?:also\b|is\b|are\b|will\b|has\b|have\b|(?:также|возвраща[а-яё]*)(?=\s|$))/i.test(source)) return null;
  return source.match(/^\s+([^,.!?]{1,60}?)(?=\s+(?:и|and)\s+|[,!?.]|$)/i)?.[1] || null;
}

function shouldCaptureFollowingSkinName(text, skinListMode) {
  return skinListMode === 'returning'
    || /returning\b|returns?\b|повторн/i.test(text)
    || isReturningMiniPassSkin(text);
}

function extractSkinSuffix(afterChampion, captureFollowingName) {
  const chroma = afterChampion.match(/^\s*(\((?:pink|yellow|amber|purple|[^)]+)\))/i)?.[1];
  if (chroma) return chroma;
  const releaseCaption = SKIN_RELEASE_CAPTION_PATTERN.exec(afterChampion);
  const beforeRelease = releaseCaption ? cleanText(afterChampion.slice(0, releaseCaption.index)) : afterChampion;
  if (captureFollowingName) return extractFollowingSkinName(beforeRelease) || "";
  return beforeRelease === afterChampion ? "" : cleanText(beforeRelease);
}

function normalizeRussianMasculineAdjective(value) {
  const word = cleanText(value);
  if (/ого$/iu.test(word)) return `${word.slice(0, -3)}ый`;
  if (/его$/iu.test(word)) return `${word.slice(0, -3)}ий`;
  return word;
}

function extractSkinTitleAfterDescription(prefix, locale) {
  const separator = Math.max(prefix.lastIndexOf("—"), prefix.lastIndexOf("–"), prefix.lastIndexOf("-"));
  if (separator < 0) return null;

  const description = cleanText(prefix.slice(0, separator));
  let titlePrefix = cleanText(prefix.slice(separator + 1));
  if (!/(?:skins?|облик[\p{L}]*|образ[\p{L}]*|костюм[\p{L}]*)/iu.test(description)) return null;
  if (!titlePrefix || titlePrefix.split(/\s+/u).length > 4) return null;
  if (locale === "ru-ru" && titlePrefix.split(/\s+/u).length === 1) {
    titlePrefix = normalizeRussianMasculineAdjective(titlePrefix);
  }
  return titlePrefix;
}

const PATCH_SKIN_SLUGS = [
  { champion: 'jax', aliases: ['glorious eminence jax', 'блистательная знаменитость джакс'], slug: 'jax-glorious-eminence-jax' },
  { champion: 'varus', aliases: ['soul fighter varus', 'боевая душа варус'], slug: 'varus-soul-fighter-varus' },
  { champion: 'varus', aliases: ['ascended soul fighter varus', 'вознесшаяся боевая душа варус'], slug: 'varus-ascended-soul-fighter-varus' },
  { champion: 'galio', aliases: ['hexplorer galio', 'защитник хекспедиции галио'], slug: 'galio-hexplorer-galio', nameRu: 'Защитник хекспедиции Галио' },
  { champion: 'graves', aliases: ['supervillain graves', 'суперзлодей грейвз'], slug: 'graves-supervillain-graves', nameEn: 'Supervillain Graves', nameRu: 'Суперзлодей Грейвз' },
  { champion: 'graves', aliases: ['ascended supervillain graves', 'вознесшийся суперзлодей грейвз'], slug: 'graves-ascended-supervillain-graves', nameEn: 'Ascended Supervillain Graves', nameRu: 'Вознесшийся Суперзлодей Грейвз' },
  { champion: 'vi', aliases: ['superhero vi', 'супергероиня вай'], slug: 'vi-superhero-vi' },
  { champion: 'vi', aliases: ['ascended superhero vi', 'вознесшаяся супергероиня вай'], slug: 'vi-ascended-superhero-vi' },
  { champion: 'nasus', aliases: ['dream raider nasus', 'похититель снов насус'], slug: 'nasus-dream-raider-nasus' },
  { champion: 'nasus', aliases: ['ascended dream raider nasus', 'вознесшийся похититель снов насус'], slug: 'nasus-ascended-dream-raider-nasus' },
  { champion: 'lulu', aliases: ['pajama guardian lulu', 'защитница в пижаме лулу'], slug: 'lulu-pajama-guardian-lulu' },
  { champion: 'ornn', aliases: ['choo choo ornn', 'машинист орн'], slug: 'ornn-choo-choo-ornn' },
  { champion: 'ornn', aliases: ['choo choo ornn yellow', 'машинист орн желтый'], slug: 'ornn-choo-choo-ornn-yellow' },
  { champion: 'zoe', aliases: ['cyber pop zoe', 'киберпоп зои'], slug: 'zoe-cyber-pop-zoe', nameRu: 'Киберпоп-Зои' },
  { champion: 'master-yi', aliases: ['psy ops master yi special edition', 'мастер йи из пси отряда особое издание'], slug: 'master-yi-psy-ops-master-yi-special-edition' },
  { champion: 'viego', aliases: ['soul fighter viego', 'боевая душа виего'], slug: 'viego-soul-fighter-viego' },
  { champion: 'senna', aliases: ['soul fighter senna', 'боевая душа сенна'], slug: 'senna-soul-fighter-senna' },
  { champion: 'ambessa', aliases: ['soul fighter ambessa', 'боевая душа амбесса'], slug: 'ambessa-soul-fighter-ambessa' },
  { champion: 'viktor', aliases: ['soul fighter viktor', 'боевая душа виктор'], slug: 'viktor-soul-fighter-viktor' },
  { champion: 'renekton', aliases: ['glorious eminence renekton', 'блистательная знаменитость ренектон'], slug: 'renekton-glorious-eminence-renekton' },
  { champion: 'ryze', aliases: ['movie director ryze', 'режиссер райз'], slug: 'ryze-movie-director-ryze', nameRu: 'Режиссер Райз' },
  { champion: 'ryze', aliases: ['ascended movie director ryze', 'вознесшийся режиссер райз'], slug: 'ryze-ascended-movie-director-ryze', nameRu: 'Вознесшийся режиссер Райз' },
  { champion: 'khazix', aliases: ['dream raider kha zix', 'похититель снов ка зикс'], slug: 'khazix-dream-raider-khazix' },
  { champion: 'khazix', aliases: ['ascended dream raider kha zix', 'вознесшийся похититель снов ка зикс'], slug: 'khazix-ascended-dream-raider-khazix' },
  { champion: 'jayce', aliases: ['superhero jayce', 'супергерой джейс'], slug: 'jayce-superhero-jayce' },
  { champion: 'jayce', aliases: ['ascended superhero jayce', 'вознесшийся супергерой джейс'], slug: 'jayce-ascended-superhero-jayce' },
  { champion: 'xayah', aliases: ['elderwood xayah', 'дух леса шая'], slug: 'xayah-elderwood-xayah' },
  { champion: 'xayah', aliases: ['elderwood xayah indigo', 'дух леса шая темно синий'], slug: 'xayah-elderwood-xayah-indigo' },
  { champion: 'rakan', aliases: ['elderwood rakan', 'дух леса рэйкан'], slug: 'rakan-elderwood-rakan' },
  { champion: 'rakan', aliases: ['elderwood rakan turquoise', 'дух леса рэйкан бирюзовый'], slug: 'rakan-elderwood-rakan-turquoise' },
  { champion: 'zoe', aliases: ['cyber pop zoe chromas', 'цветовые схемы киберпоп зои', 'киберпоп зои цветовые схемы'], slug: 'zoe-cyber-pop-zoe-chromas', nameRu: 'Киберпоп-Зои (цветовые схемы)' },
  { champion: 'nasus', aliases: ['battlecast nasus', 'модифицированный насус', 'модифицированным насус'], slug: 'nasus-battlecast-nasus', nameRu: 'Модифицированный Насус' },
  { champion: 'lulu', aliases: ['purple garlic lulu', 'фиолетовый чеснок лулу'], slug: 'lulu-purple-garlic-lulu' },
  { champion: 'vayne', aliases: ['dragonmancer vayne', 'дракомант вейн'], slug: 'vayne-dragonmancer-vayne' },
  { champion: 'fiora', aliases: ['dragonmancer fiora', 'дракомант фиора'], slug: 'fiora-dragonmancer-fiora' },
  { champion: 'nilah', aliases: ['dragonmancer nilah', 'дракомант нила'], slug: 'nilah-dragonmancer-nilah' },
  { champion: 'mel', aliases: ['love confession mel', 'мэл признание в любви', 'признание в любви мэл'], slug: 'mel-love-confession-mel' },
  { champion: 'jayce', aliases: ['love confession jayce', 'признание в любви джейс'], slug: 'jayce-love-confession-jayce' },
  { champion: 'milio', aliases: ['glorious eminence milio', 'блистательная знаменитость милио'], slug: 'milio-glorious-eminence-milio' },
  { champion: 'kogmaw', aliases: ['pencil sharpener kog maw', 'точилка для карандашеи ког мао'], slug: 'kogmaw-pencil-sharpener-kogmaw' },
  { champion: 'kogmaw', aliases: ['ascended pencil sharpener kog maw', 'вознесшаяся точилка для карандашеи ког мао'], slug: 'kogmaw-ascended-pencil-sharpener-kogmaw' },
  { champion: 'smolder', aliases: ['reindeer smolder', 'олень смолдер'], slug: 'smolder-reindeer-smolder' },
  { champion: 'smolder', aliases: ['reindeer smolder pink', 'олень смолдер розовыи'], slug: 'smolder-reindeer-smolder-pink' },
  { champion: 'skarner', aliases: ['scorpio deity skarner', 'cosmic sting skarner', 'космическое жало скарнер'], slug: 'skarner-scorpio-deity-skarner' },
  { champion: 'skarner', aliases: ['scorpio deity ancient wisdom skarner', 'древняя мудрость божества скорпиона скарнер'], slug: 'skarner-scorpio-deity-ancient-wisdom-skarner' },
  { champion: 'renekton', aliases: ['blackfrost renekton', 'ренектон черная стужа'], slug: 'renekton-blackfrost-renekton', nameEn: 'Blackfrost Renekton', nameRu: 'Ренектон Черная Стужа' },
  { champion: 'renekton', aliases: ['blackfrost renekton purple', 'ренектон черная стужа фиолетовыи'], slug: 'renekton-blackfrost-renekton-purple', nameEn: 'Blackfrost Renekton (Purple)', nameRu: 'Ренектон Черная Стужа (фиолетовый)' },
  { champion: 'ornn', aliases: ['choo choo ornn', 'машинист орн'], slug: 'ornn-choo-choo-ornn' },
  { champion: 'urgot', aliases: ['battlecast urgot', 'модифицированныи ургот'], slug: 'urgot-battlecast-urgot' },
  { champion: 'nasus', aliases: ['dream raider nasus', 'похититель снов насус'], slug: 'nasus-dream-raider-nasus' },
  { champion: 'nasus', aliases: ['unleashed dream raider nasus', 'вознесшийся похититель снов насус'], slug: 'nasus-unleashed-dream-raider-nasus' },
  { champion: 'thresh', aliases: ['dream raider thresh', 'похититель снов треш'], slug: 'thresh-dream-raider-thresh' },
  { champion: 'thresh', aliases: ['unleashed dream raider thresh', 'освобожденный похититель снов треш'], slug: 'thresh-unleashed-dream-raider-thresh' },
  { champion: 'amumu', aliases: ['food spirits amumu', 'гурман амуму'], slug: 'amumu-food-spirits-amumu', nameEn: 'Food Spirits Amumu', nameRu: 'Гурман Амуму' },
  { champion: 'amumu', aliases: ['ascended food spirits amumu', 'вознесшийся гурман амуму'], slug: 'amumu-ascended-food-spirits-amumu', nameEn: 'Ascended Food Spirits Amumu', nameRu: 'Вознесшийся Гурман Амуму' },
  { champion: 'ekko', aliases: ['psychic detective ekko', 'пси детектив экко'], slug: 'ekko-psychic-detective-ekko', nameEn: 'Psychic Detective Ekko', nameRu: 'Пси-детектив Экко' },
  { champion: 'ekko', aliases: ['ascended psychic detective ekko', 'вознесшийся пси детектив экко'], slug: 'ekko-ascended-psychic-detective-ekko', nameEn: 'Ascended Psychic Detective Ekko', nameRu: 'Вознесшийся Пси-детектив Экко' },
  { champion: 'xin-zhao', aliases: ['glorious crown xin zhao', 'блистательный король ксин жао'], slug: 'xin-zhao-glorious-crown-xin-zhao', nameEn: 'Glorious Crown Xin Zhao', nameRu: 'Блистательный король Ксин Жао' },
  { champion: 'veigar', aliases: ['food spirits veigar', 'фруктовый вейгар'], slug: 'veigar-food-spirits-veigar', nameEn: 'Food Spirits Veigar', nameRu: 'Фруктовый Вейгар' },
  { champion: 'veigar', aliases: ['ascended food spirits veigar', 'вознесшийся фруктовый вейгар'], slug: 'veigar-ascended-food-spirits-veigar', nameEn: 'Ascended Food Spirits Veigar', nameRu: 'Вознесшийся Фруктовый Вейгар' },
  { champion: 'kayle', aliases: ['dragonslayer kayle', 'убийца драконов кейл'], slug: 'kayle-dragonslayer-kayle' },
  { champion: 'kayle', aliases: ['dragonslayer kayle amber', 'убийца драконов кейл янтарный'], slug: 'kayle-dragonslayer-kayle-amber' },
  { champion: 'taliyah', aliases: ['pool party taliyah', 'тусовая талия'], slug: 'taliyah-pool-party-taliyah' },
  { champion: 'norra', aliases: ['cafe cuties norra', 'норра из кафе красоты'], slug: 'norra-cafe-cuties-norra' },
  { champion: 'aatrox', aliases: ['mecha aatrox exquisite edition', 'механический атрокс изысканное издание'], slug: 'aatrox-mecha-aatrox-exquisite-edition' },
  { champion: 'sion', aliases: ['plant protector sion', 'защитник растений сион'], slug: 'sion-plant-protector-sion' },
  { champion: 'samira', aliases: ['ashen avenger samira', 'пепельная мстительница самира'], slug: 'samira-ashen-avenger-samira' },
];

function getCanonicalAnnouncementSkinSlug(championSlug, skinName) {
  const skin = findCanonicalSkinRecord(championSlug, skinName);
  const normalized = normalizeEntityName(skinName);
  return skin?.slug || `${championSlug}-${normalized.replace(/\s+/g, '-')}`;
}

function findCanonicalSkinRecord(championSlug, skinName) {
  const normalized = normalizeEntityName(skinName);
  const candidates = PATCH_SKIN_SLUGS.filter((entry) => entry.champion === championSlug);
  const aliases = candidates.flatMap((entry) => entry.aliases.map((alias) => ({
    entry,
    alias: normalizeEntityName(alias),
  }))).sort((left, right) => right.alias.length - left.alias.length);
  return aliases.find(({ alias }) => alias === normalized)?.entry
    || aliases.find(({ alias }) => normalized.startsWith(`${alias} `))?.entry
    || aliases.find(({ alias }) => ` ${normalized} `.includes(` ${alias} `))?.entry;
}

function getCanonicalSkinName(championSlug, skinName, locale) {
  const record = findCanonicalSkinRecord(championSlug, skinName);
  return (locale === "ru-ru" ? record?.nameRu : record?.nameEn) || skinName;
}

function extractSkinName(text, championAlias, matchedAt = null, captureFollowingName = false, matchedChampionName = null, locale = "en-us") {
  const source = cleanText(text);
  const occurrence = Number.isInteger(matchedAt)
    ? matchedAt
    : source.toLowerCase().lastIndexOf(championAlias.toLowerCase());
  if (occurrence < 0) return null;
  const championNameText = matchedChampionName || source.slice(occurrence, occurrence + championAlias.length);
  const end = occurrence + championNameText.length;
  const quoted = Array.from(source.matchAll(/["“«]([^"”»]+)["”»]/g))
    .map((match) => match[1])
    .find((candidate) => candidate.toLowerCase().includes(championAlias.toLowerCase()));
  if (quoted) return cleanText(quoted);

  let start = Math.max(
    source.lastIndexOf(",", occurrence),
    source.lastIndexOf(";", occurrence),
    source.lastIndexOf(".", occurrence),
    source.lastIndexOf(":", occurrence),
  ) + 1;
  let prefix = source.slice(start, occurrence);
  const lastConnector = Math.max(prefix.lastIndexOf(" и "), prefix.lastIndexOf(" and "));
  if (lastConnector >= 0) prefix = prefix.slice(lastConnector + (prefix.slice(lastConnector).startsWith(" и ") ? 3 : 5));
  prefix = prefix.replace(/^.*?(?:где вас будет ждать|вас будет ждать|на этот раз|вас ждут|получите|вы встретите|встретите|unlock(?: the)?|you can get|obtain|along with its upgraded version|вместе с его улучшенной версией|в главных ролях|(?:this\s+)?(?:new\s+)?(?:wild pass|mini(?: wild)? pass)\s+(?:is|features?|featuring|starring)|all-new|(?:the )?new (?:season-exclusive |exclusive )?(?:skins?|skin)|new (?:season-exclusive |exclusive )?(?:skins?|skin)|season-exclusive skin|brand-new exclusive grand skin reward[^:]*?obtain|нов(?:ый|ые) (?:эксклюзивный )?(?:облик|образ)|эксклюзивный образ|(?:повторный\s+)?(?:мини-)?пропуск(?:а|у|ом|е|и|ов|ам|ами|ах)?(?:\s+wild rift)?[,]?\s*(?:с\s+)?|образы?(?:\s+(?:мини-)?пропуска)?[^:]*:|доступны новые образы?\s*[–—:-]*|returning skins?[^:]*:|skins?[^:]*:|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+chromas?\s+(?:for|of)|featuring|starring)\s*/i, "");
  prefix = prefix.replace(/^.*?(?:вы\s+встретите|встретите|вас\s+(?:ждет|ждут)|вы\s+получите|вам\s+достанется)\s*/i, "");
  prefix = extractSkinTitleAfterDescription(prefix, locale) || prefix;
  const afterChampion = source.slice(end);
  let skinSuffix = extractSkinSuffix(afterChampion, captureFollowingName);
  if (/^\s*(?:will|is|has|have|arrives?|выйдет|появится|будет|станет)\b/i.test(skinSuffix)) skinSuffix = "";
  const candidate = cleanText(`${prefix} ${championNameText} ${skinSuffix}`)
    .replace(/^["“«]|["”»]$/g, "")
    .replace(/^(?:the )?all-new\s+/i, "")
    .replace(/^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i, "")
    .replace(/^(?:(?:its|their)\s+)?chroma\s+/i, "")
    .replace(/^(?:participate .*? to obtain|joining him will be)\s+/i, "")
    .replace(/^(?:образ|облик|skin)\s+/i, "")
    .replace(/\s+skin$/i, "");
  if (candidate.split(/\s+/).length < 2) return null;
  // Patch prose can mention an existing skin or start an unrelated example with
  // the champion's name. Such sentences are not cosmetic announcements.
  if (/^(?:(?:теперь|что|раньше|обновили|переработали|улучшили|изменили|изменения|модель|анимаци|визуальн|старые|новые|единственной|тогда|в рамках|в бой ворвется|для каждого|за каждые|в сундуках)(?:\s|$)|(?:you|now|previously|updated|reworked|improved|changes?|model|animation|visual|what|for every|including|the all new|we've also updated)\b)/i.test(candidate)
    || /(?:скорост[ьи] атаки|базов(?:ой|ая) скорост|attack speed|base attack|visual update|visuals of)/i.test(candidate)) return null;
  return candidate;
}

function createAnnouncementState(champions, add) {
  return { champions, add, inNewSection: false, inNewChampionSection: false, candidateChampion: null, ignoringMode: false, ignoredModeLevel: null, skinListMode: null };
}

function findExactChampion(champions, value) {
  const normalized = normalizeEntityName(value);
  return champions.find((champion) => champion.aliases.some((alias) => normalizeEntityName(alias) === normalized)) || null;
}

function findChampionHeadingMatch(champions, text) {
  const normalized = normalizeEntityName(text);
  const withoutSubtitle = normalizeEntityName(text.replace(/,.*$/, ''));
  return champions.find((champion) => champion.aliases.some((alias) => {
    const normalizedAlias = normalizeEntityName(alias);
    return normalizedAlias === withoutSubtitle || normalized.startsWith(`${normalizedAlias} `);
  })) || null;
}

function displayChampionName(value) {
  const name = cleanText(value);
  return /^[А-ЯЁ\s'’-]+$/.test(name)
    ? `${name[0]}${name.slice(1).toLocaleLowerCase('ru-RU')}`
    : name;
}

function addNewChampionHeading(state, text, known, displayName) {
  state.add({
    entityKind: 'champion',
    entityName: known?.name || displayName,
    ...(known?.slug ? { entitySlug: known.slug } : {}),
    changeName: 'new',
    sectionName: text,
    details: [{ label: null, before: null, after: null, text: 'Новый чемпион.' }],
  });
  state.candidateChampion = { champion: known || { name: displayName, slug: null }, name: text };
}

function setAnnouncementH2(state, text, tag) {
  const level = Number(tag.slice(1));
  state.ignoredModeLevel = advanceIgnoredGameModeScope(text, level, state.ignoredModeLevel);
  const isModeSection = isGameModeHeading(text)
    || /game mode changes|игровых? режим|режим приключени|^adventure mode$/i.test(text);
  if (isModeSection) state.ignoredModeLevel = level;
  state.ignoringMode = state.ignoredModeLevel !== null || isModeSection;
  state.inNewSection = !state.ignoringMode && /^(?:new|новое)$/i.test(text);
  state.skinListMode = !state.ignoringMode && (/^(?:skins?|облики|образы)$/i.test(text)
    || /^(?:new|новый)\s+(?:wild pass|mini wild pass|mini pass|пропуск wild rift)$/i.test(text)) ? 'new' : null;
  state.candidateChampion = null;
}

function setAnnouncementSkinMode(state, text) {
  const isHeading = /^(?:returning\s+.*skins?|new\s+.*skins?|skins?|повторные\s+образы?(?:\s+[^:]+)?|повторные\s+облики?(?:\s+[^:]+)?|новые\s+образы?(?:\s+[^:]+)?|новые\s+облики?(?:\s+[^:]+)?|облики?|образы?)\s*:?$/i.test(text);
  state.skinListMode = isHeading
    ? (/returning|повторн/i.test(text) ? 'returning' : /new|новые/i.test(text) ? 'new' : 'available')
    : null;
}

function handleAnnouncementChampionHeading(state, tag, text, wasInNewChampionSection) {
  if (wasInNewChampionSection && tag !== 'h3') {
    const displayName = displayChampionName(cleanText(text.split(/[,—–—]/, 1)[0]));
    addNewChampionHeading(state, text, findExactChampion(state.champions, displayName), displayName);
    return;
  }
  if (!state.inNewChampionSection && !state.inNewSection) return;
  const matched = findChampionHeadingMatch(state.champions, text);
  if (matched) {
    state.candidateChampion = { champion: matched, name: text };
    if (state.inNewChampionSection) addNewChampionHeading(state, text, matched, matched.name);
    return;
  }
  if (state.inNewSection && tag === 'h4' && /,/.test(text)) {
    const displayName = displayChampionName(cleanText(text.split(',', 1)[0]));
    state.candidateChampion = { champion: { name: displayName, slug: null }, name: text };
  }
}

function handleAnnouncementSubheading(state, tag, text) {
  const level = Number(tag.slice(1));
  state.ignoredModeLevel = advanceIgnoredGameModeScope(text, level, state.ignoredModeLevel);
  state.ignoringMode = state.ignoredModeLevel !== null;
  if (/game mode changes|игровых? режим|режим приключени|арена|aaa\s*aram|отвязное безумие/i.test(text)) {
    state.ignoringMode = true;
    state.ignoredModeLevel = level;
    state.candidateChampion = null;
    return;
  }
  if (state.ignoringMode) return;
  setAnnouncementSkinMode(state, text);
  const wasInNewChampionSection = state.inNewChampionSection;
  state.inNewChampionSection = /^(?:new champions?|новые чемпионы)$/i.test(text);
  state.candidateChampion = null;
  handleAnnouncementChampionHeading(state, tag, text, wasInNewChampionSection);
}

function addAnnouncementChampionRelease(state, text) {
  if (!state.candidateChampion || !/(?:появится в игре|выйдет в игру|станет доступ|available|arrives?|joins? the game)/i.test(text)) return;
  state.add({
    entityKind: 'champion',
    entityName: state.candidateChampion.champion.name,
    entitySlug: state.candidateChampion.champion.slug,
    changeName: 'new',
    sectionName: state.candidateChampion.name,
    details: [{ label: null, before: null, after: null, text }],
  });
  state.candidateChampion = null;
}

function isReturningMiniPassSkin(text) {
  return /возвраща[а-яё]*.{0,80}с собственн[а-яё]*.{0,40}(?:шкал[а-яё]*|трек[а-яё]*).{0,30}мини-пропуск/i.test(text);
}

function hasSkinAnnouncementCue(text, skinListMode) {
  const hasCue = /(?:(?<![\p{L}\p{N}_])(?:облик|образ(?!\s+жизни)|скин|skins?)|костюм|цветов[а-яё]*\s+схем[а-яё]*|хроматик|появится в игре|появятся в игре|выйдет в игру|выйдут в игру|станет доступ|available|arrives?|joins? the game|releas(?:e|es|ed|ing)|all-new|в главных ролях|(?:wild pass|mini pass).{0,120}(?:starring|featuring)|(?:пропуск|мини-пропуск).{0,120}(?:в главных ролях|ждет|ждут|на сцену))/iu.test(text)
    || isReturningMiniPassSkin(text)
    || /(?:wild pass|mini pass|мини-пропуск|пропуск wild rift)/iu.test(text)
    || SKIN_RELEASE_CAPTION_PATTERN.test(text)
    || Boolean(skinListMode);
  return hasCue && (Boolean(skinListMode) || isReturningMiniPassSkin(text)
    || /(?:(?<![\p{L}\p{N}_])(?:облик|образ(?!\s+жизни)|скин|skins?)|цветов[а-яё]*\s+схем[а-яё]*|хроматик|chromas?|появится в игре|появятся в игре|выйдет в игру|выйдут в игру|доступен|доступна|available|arrives?|joins? the game|releas(?:e|es|ed|ing)|в главных ролях|(?:wild pass|mini pass|мини-пропуск|пропуск wild rift))/iu.test(text)
    || SKIN_RELEASE_CAPTION_PATTERN.test(text));
}

function hasSkinAnnouncementCueForMatch(text, skinListMode, match) {
  if (skinListMode) return hasSkinAnnouncementCue(text, skinListMode);

  const sourceText = String(text);
  if (isScreenSharingSkinAcquisitionList(sourceText)
    && !hasSkinAnnouncementCue(sourceText.replace(/\bnew skins? acquired\b/gi, " "), null)) return false;

  const cueStart = Math.max(0, match.index - 120);
  const cueEnd = Math.min(sourceText.length, match.index + match[0].length + 160);
  const nearbyText = sourceText.slice(cueStart, cueEnd);
  const skinSpecificCue = /(?:(?<![\p{L}\p{N}_])(?:облик|образ(?!\s+жизни)|скин|skins?)|костюм|цветов[а-яё]*\s+схем[а-яё]*|хроматик|chromas?|\bwild pass\b|\bmini pass\b|мини-пропуск|пропуск wild rift|в главных ролях|starring|featuring)/iu;
  if (!skinSpecificCue.test(nearbyText) && !SKIN_RELEASE_CAPTION_PATTERN.test(nearbyText)) return false;

  const cueText = sourceText.replace(/\([^()]*\)/g, (parenthetical, offset) => {
    const matchIsInside = match.index >= offset && match.index < offset + parenthetical.length;
    if (matchIsInside || !hasSkinAnnouncementCue(parenthetical.slice(1, -1), null)) return parenthetical;
    return " ";
  });
  return hasSkinAnnouncementCue(cueText, null);
}

function isScreenSharingSkinAcquisitionList(text) {
  return /\bnew skins? acquired\b/i.test(text)
    && /\b(?:save|share)\b/i.test(text)
    && /\b(?:screens? to\b|camera roll|facebook)\b/i.test(text);
}

function getAnnouncementSkinFlags(text, champion, skinListMode) {
  const explicitReturning = /(?:returning\b|returns?\b|return track|возвраща[а-яё]* облик|повторн[а-яё]* (?:облик|образ|наград)|образы возвраща[а-яё]*|образы прошлых лет)/i.test(text)
    || isReturningMiniPassSkin(text);
  const explicitNew = /(?:нов[а-яё]* (?:эксклюзивный )?(?:облик|образ)|эксклюзивн[а-яё]* (?:облик|образ)|new (?:season-exclusive |exclusive )?skins?|new skin|season-exclusive skin|brand-new exclusive grand skin|all-new|(?:wild pass|mini pass) arrives?.{0,100}(?:featuring|starring)|new .{0,60}(?:wild pass|mini pass).{0,100}(?:featuring|starring)|(?:wild pass|mini pass).{0,100}(?:premieres?|takes center stage|featuring|starring)|(?:releas(?:e|es|ed|ing)|joins? the game|available)|(?:пропуск|мини-пропуск).{0,100}(?:выйдет|ждет|будет ждать|появится|на сцену)|нового пропуска|в главных ролях|появится в игре|появятся в игре|выйдет в игру|выйдут в игру|доступен|доступна)/i.test(text)
    || SKIN_RELEASE_CAPTION_PATTERN.test(text);
  const chromaMention = /(?:хроматик|цветов[а-яё]*\s+схем[а-яё]*|chromas?)/i.test(text);
  const returning = explicitReturning || (skinListMode === 'returning' && !explicitNew && !chromaMention);
  const newSkin = !returning && (skinListMode === 'new' || explicitNew);
  const chromaOnly = /(?:хроматик|цветов[а-яё]*\s+схем[а-яё]*|chromas?)/i.test(text) && !returning && !newSkin;
  const unnamedChromaSet = chromaOnly && /\b\d+\s+chromas?\b|\bchromas?\b|хроматик|цветов[а-яё]*\s+схем[а-яё]*/i.test(text);
  return { returning, newSkin, chromaOnly, unnamedChromaSet };
}

function isColorVariant(value) {
  return /\((?:pink|yellow|amber|purple|розов[а-яё]*|желт[а-яё]*|янтарн[а-яё]*|фиолетов[а-яё]*)\)/i.test(value);
}

function isAnnouncementChestSkinMention(text) {
  if (/(?:contains six hidden chromas|содержит шесть тайных цветов[а-яё]*\s+схем)/i.test(text)) return false;
  if (/(?:\b(?:lucky|random)\s+chroma\s+chest\b|(?:счастлив\p{L}*|случайн\p{L}*)\s+сундук\s+(?:со\s+случайн\p{L}*\s+)?цветов\p{L}*\s+схем\p{L}*)/iu.test(text)) return true;
  return /(?:friendship|skin) chest.{0,80}(?:skin drops|includes)|(?:сундук|сокровищниц).{0,80}(?:выпада|содерж[а-яё]*).{0,40}(?:облик|образ)|this season's rewards are all themed around.{0,100}chromas|награды этого сезона посвящены.{0,100}хроматик/i.test(text);
}

function getAnnouncementSkinTitle(entityName, champion, flags, locale, sourceText = null, aliasMatch = null) {
  const extractedTitle = cleanSkinTitle(entityName);
  const hasNamedChromaSkin = flags.unnamedChromaSet
    && !/\s+chromas?$/i.test(extractedTitle)
    && !champion.aliases?.some((alias) => normalizeEntityName(extractedTitle) === normalizeEntityName(alias));
  if (flags.unnamedChromaSet) {
    const baseName = extractedTitle.replace(/\s+chromas?$/i, "") || champion.name;
    const namedBase = hasNamedChromaSkin ? baseName : champion.name;
    const chromaPrefix = !hasNamedChromaSkin && locale !== 'ru-ru'
      ? getAnnouncementChromaPrefix(champion, sourceText, aliasMatch)
      : null;
    const familyBase = chromaPrefix ? `${chromaPrefix} ${namedBase}` : namedBase;
    const familyName = locale === 'ru-ru' ? `${familyBase} (цветовые схемы)` : `${familyBase} chromas`;
    return getCanonicalSkinName(champion.slug, familyName, locale);
  }
  return extractedTitle;
}

function getAnnouncementChromaPrefix(champion, text, match) {
  if (!text || !match || !Number.isInteger(match.index)) return null;
  const preceding = String(text).slice(0, match.index);
  const commandStart = [...preceding.matchAll(/(?:^|[.!?]\s*)(?:unlock|obtain|receive|get|featuring|starring)\b/ig)].at(-1);
  const tail = commandStart ? preceding.slice(commandStart.index + commandStart[0].length) : "";
  const prefix = cleanText(tail
    .replace(/^\s*(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:(?:new|all-new|exclusive)\s*)?/i, "")
    .replace(/[,:;–—-]+\s*$/g, ""));
  if (!prefix || prefix.split(/\s+/).length > 5) return null;
  if (champion.aliases?.some((alias) => normalizeEntityName(prefix) === normalizeEntityName(alias))) return null;
  return prefix;
}

function getPatchSkinSectionName(locale, returning, tableSection = false) {
  if (locale === "ru-ru") return returning ? "Повторные облики" : "Облики патча";
  if (tableSection) return returning ? "Returning Skins" : "SKINS";
  return returning ? "Returning Skins" : "Patch Skins";
}

function getPatchSkinAvailabilityText(locale, listed = false) {
  if (locale === "ru-ru") return listed ? "Облик указан в списке обликов патча." : "Облик доступен в патче.";
  return listed ? "Skin listed in the patch notes." : "Skin available in this patch.";
}

function getSkinReleaseDetail(text, locale) {
  const clean = cleanText(text);
  const datePattern = locale === "ru-ru"
    ? /(?:Появится|Появятся|Выйдет|Выйдут) в игре\s+\d{1,2}\s+[А-Яа-яЁё]+\s+в\s+\d{1,2}:\d{2}\s+по московскому времени/i
    : /(?:Releasing|Released)\s+[A-Za-z]+\s+\d{1,2}\s*@\s*\d{2}:\d{2}\s+UTC/i;
  const patchPattern = locale === "ru-ru"
    ? /(?:выйдет|выйдут|появится|появятся|станет доступен|станет доступна|будет доступен|будет доступна)\s+в\s+(?:патче\s+)?\d+\.\d+[a-zа-я]*/i
    : /(?:actually\s+)?(?:releasing|released|available)\s+(?:in|with)\s+(?:patch\s+)?\d+\.\d+[a-z]*/i;
  return clean.match(datePattern)?.[0] || clean.match(patchPattern)?.[0] || null;
}

function shouldIgnoreAnnouncementSkin(text, alias, match) {
  const textAfterChampion = text.slice(match.index + match[0].length);
  if (/^\s*(?:\*{1,2}\s*)?(?:released|releasing)\s+if\b/i.test(text)) return true;
  if (/^\s*['’]s\s+(?:vgu|rework|visual\s+(?:update|rework)|balance\s+(?:updates?|changes?))/i.test(textAfterChampion)) return true;
  if (/(?:\b(?:available|releas(?:ed|ing)|arriv(?:e|es|ing))\b.{0,40}\b(?:later(?: on)?|in a future patch|next patch)\b|\b(?:later(?: on)?|future patch|next patch)\b.{0,40}\b(?:available|releas(?:ed|ing)|arriv(?:e|s|ing))\b)/i.test(text)) return true;
  if (/(?:information|информация).{0,40}(?:incorrect|wrong|неверн|ошибочн)/i.test(text)) return true;
  if (/(?:назван[а-яё]*|names?).{0,100}(?:облик(?:а|ов)?|образ(?:а|ов)?|skins?).{0,100}(?:incorrect|wrong|неверн|некорректн|ошибочн)|(?:облик(?:а|ов)?|образ(?:а|ов)?|skins?).{0,100}(?:назван[а-яё]*|names?).{0,100}(?:incorrect|wrong|неверн|некорректн|ошибочн)/i.test(text)) return true;
  if (/(?:currently (?:a )?bug|there is currently a bug|присутствует ошибка|сейчас ошибка)/i.test(text)
    && /(?:available until|will be available until|будет доступен до|на самом деле.*доступен до)/i.test(text)) return true;
  if (isAnnouncementChestSkinMention(text)) return true;
  if (/(?:has arrived on the rift|arrives on the rift|прибывает в ущелье|прибывает на рифт)/i.test(text)
    && !/(?:skin|облик|образ|скин)/i.test(text)) return true;
  if (/^-new\b/i.test(text.slice(match.index + alias.length))
    || /^a\s+$/i.test(text.slice(Math.max(0, match.index - 2), match.index))) return true;
  return false;
}

function makeAnnouncementSkinChange(text, champion, alias, match, skinListMode, locale) {
  if (shouldIgnoreAnnouncementSkin(text, alias, match)) return null;
  const entityName = extractSkinName(text, alias, match.index, shouldCaptureFollowingSkinName(text, skinListMode), match[0], locale);
  if (!entityName) return null;
  const flags = getAnnouncementSkinFlags(text, champion, skinListMode);
  if (flags.unnamedChromaSet && isGenericChromaRewardMention(text, match)) return null;
  if (flags.chromaOnly && !flags.unnamedChromaSet) return null;
  const skinName = getCanonicalSkinName(champion.slug, getAnnouncementSkinTitle(entityName, champion, flags, locale, text, match), locale);
  if (champion.aliases?.some((alias) => normalizeEntityName(skinName) === normalizeEntityName(alias))) return null;
  return {
    entityKind: 'skin',
    entityName: skinName,
    entitySlug: getCanonicalAnnouncementSkinSlug(champion.slug, skinName),
    sourceChampionSlug: champion.slug,
    changeName: flags.returning ? 'returning' : flags.newSkin && !flags.unnamedChromaSet && !isColorVariant(skinName) ? 'new' : 'available',
    sectionName: getPatchSkinSectionName(locale, flags.returning, true),
    details: [{
      label: null,
      before: null,
      after: null,
      text: flags.legendsChroma || flags.unnamedChromaSet || /\b\d{1,2}\s+(?:[a-z]+|[а-яё]+)/i.test(text)
        ? getSkinReleaseDetail(text, locale) || text
        : getPatchSkinAvailabilityText(locale),
    }],
  };
}

function isGenericChromaRewardMention(text, match) {
  const preceding = String(text).slice(0, match.index);
  return /(?:color\s+schemes?|chromas?|цветов[а-яё]*\s+схем[а-яё]*|хроматик[а-яё]*)\s+(?:for|of|для)\s*$/iu.test(preceding);
}

function extractAnnouncementSkinChanges(text, champions, skinListMode, locale) {
  if (!hasSkinAnnouncementCue(text, skinListMode)) return [];
  const matches = findAllSkinAliasMatches(text, champions);
  const seen = new Set();
  return matches
    .filter(({ champion, match }) => {
      const key = `${champion.slug}:${match.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter(({ match }) => hasSkinAnnouncementCueForMatch(text, skinListMode, match))
    .map(({ champion, alias, match }) => makeAnnouncementSkinChange(text, champion, alias, match, skinListMode, locale))
    .filter(Boolean);
}

function handleAnnouncementNode(state, tag, text) {
  if (tag === 'h1' || tag === 'h2') {
    setAnnouncementH2(state, text, tag);
    return;
  }
  if (['h3', 'h4', 'h5'].includes(tag)) {
    handleAnnouncementSubheading(state, tag, text);
    return;
  }
  if (state.ignoringMode) return;
  addAnnouncementChampionRelease(state, text);
  if (tag !== 'p' && tag !== 'li') return;
  if (['p', 'li'].includes(tag) && /^(?:returning\s+.*skins?|new\s+.*skins?|skins?|повторные\s+образы?(?:\s+[^:]+)?|повторные\s+облики?(?:\s+[^:]+)?|новые\s+образы?(?:\s+[^:]+)?|новые\s+облики?(?:\s+[^:]+)?|облики?|образы?)\s*:?$/i.test(text)) {
    state.skinListMode = /returning|повторн/i.test(text) ? 'returning' : /new|новые/i.test(text) ? 'new' : 'available';
    return;
  }
  if (tag === 'p' && /(?:wild pass|mini wild pass|mini pass)$/i.test(text)
    || tag === 'p' && /^(?:мини-пропуск|пропуск Wild Rift).{0,100}$/i.test(text)
      && !/(?:облик|образ|skin)/i.test(text)) {
    state.skinListMode = null;
    return;
  }
  for (const change of extractAnnouncementSkinChanges(text, state.champions, state.skinListMode, state.locale)) state.add(change);
}

function createChangeCollector() {
  const changes = [];
  const seen = new Map();
  return {
    changes,
    add(change) {
      const key = `${change.entityKind}:${normalizeEntityName(change.entityName)}`;
      if (!change.entityName) return;
      const existing = seen.get(key);
      if (existing) {
        if (change.entityKind === 'skin') {
          const datedDetails = (change.details || []).filter((detail) => /\b\d{1,2}\s+(?:[a-z]+|[а-яё]+)/i.test(detail.text || ""));
          existing.details ||= [];
          for (const detail of [...datedDetails, ...(change.details || []).filter((row) => !datedDetails.includes(row))]) {
            if (existing.details.some((row) => normalizeEntityName(row.text) === normalizeEntityName(detail.text))) continue;
            if (datedDetails.includes(detail)) existing.details.unshift(detail);
            else existing.details.push(detail);
          }
          if (getSkinChangePriority(change.changeName) > getSkinChangePriority(existing.changeName)) {
            const details = existing.details;
            Object.assign(existing, change, { details });
          }
        }
        return;
      }
      seen.set(key, change);
      changes.push(change);
    },
  };
}

function getSkinChangePriority(changeName) {
  return changeName === 'returning' ? 3 : changeName === 'new' ? 2 : 1;
}

function hasSkinReleaseInfo(change) {
  return (change.details || []).some((detail) => getSkinReleaseDetail(detail.text || "", "en-us")
    || getSkinReleaseDetail(detail.text || "", "ru-ru"));
}

function mergeSkinChangeRows(changes) {
  const merged = [];
  const bySkin = new Map();
  for (const change of changes) {
    if (change.entityKind !== 'skin') {
      merged.push(change);
      continue;
    }
    const key = `${change.sourceChampionSlug || ''}:${normalizeEntityName(change.entityName)}`;
    const existing = bySkin.get(key);
    if (!existing) {
      bySkin.set(key, change);
      merged.push(change);
    } else {
      const details = mergeSkinDetails(existing.details, change.details);
      if (getSkinChangePriority(change.changeName) > getSkinChangePriority(existing.changeName)) {
        Object.assign(existing, change, { details });
      } else {
        existing.details = details;
        if (hasSkinReleaseInfo(change) && !hasSkinReleaseInfo(existing)) existing.sectionName = change.sectionName;
        if (!existing.sourceImageUrl && change.sourceImageUrl) existing.sourceImageUrl = change.sourceImageUrl;
      }
    }
  }
  return merged;
}

function mergeSkinDetails(existingDetails, incomingDetails) {
  const details = [...(existingDetails || [])];
  for (const detail of incomingDetails || []) {
    const signature = [detail.label, detail.before, detail.after, detail.text, detail.component]
      .map((value) => normalizeEntityName(value || ""))
      .join("|");
    if (details.some((candidate) => [candidate.label, candidate.before, candidate.after, candidate.text, candidate.component]
      .map((value) => normalizeEntityName(value || ""))
      .join("|") === signature)) continue;
    const isSpecificRelease = Boolean(getSkinReleaseDetail(detail.text || "", "en-us")
      || getSkinReleaseDetail(detail.text || "", "ru-ru"));
    if (isSpecificRelease) {
      const fallbackIndex = details.findIndex((candidate) => /^(?:skin available in this patch\.|облик доступен в патче\.)$/i.test(candidate.text || ""));
      if (fallbackIndex >= 0) details.splice(fallbackIndex, 1);
      details.unshift(detail);
    } else {
      details.push(detail);
    }
  }
  return details;
}

function parseAnnouncementChanges(blades, catalog, locale) {
  const collector = createChangeCollector();
  const champions = uniqueChampions(catalog);
  for (const blade of Array.isArray(blades) ? blades : []) {
    const html = extractRichText(blade);
    if (!html) continue;
    const $ = load(`<div>${html}</div>`, null, false);
    const state = createAnnouncementState(champions, collector.add);
    state.locale = locale;
    // Rich skin tables are parsed separately with their image and full title.
    // Treating cell captions as prose truncates titles like the Exquisite Edition skins.
    const nodes = $.root().children().first().find('h1,h2,h3,h4,h5,h6,p,li').toArray()
      .filter((node) => !$(node).parents("table").length);
    for (const node of nodes) {
      const text = cleanText($(node).text());
      if (text) handleAnnouncementNode(state, String(node.tagName || '').toLowerCase(), text);
    }
  }
  return collector.changes;
}
function findAllSkinAliasMatches(text, champions) {
  const matches = [];
  const seen = new Set();
  for (const champion of champions) {
    for (const alias of champion.aliases) {
      const cyrillicAlias = /[а-яё]/i.test(alias);
      let aliasPattern = escapeRegex(alias);
      let endingBoundary = '(?![A-Za-z0-9А-Яа-я])';
      if (cyrillicAlias) {
        const wordStart = alias.lastIndexOf(" ") + 1;
        const finalWord = alias.slice(wordStart);
        const inflections = {
          а: "(?:а|у|ы|е|ой|ою|ам|ами|ах)",
          я: "(?:я|ю|и|е|ей|ею|ям|ями|ях)",
          й: "(?:й|я|ю|и|ем|е|ям|ями|ях)",
          ь: "(?:ь|я|ю|и|ем|е|ям|ями|ях)",
        }[finalWord.slice(-1).toLowerCase()];
        if (inflections) {
          aliasPattern = `${escapeRegex(alias.slice(0, wordStart))}${escapeRegex(finalWord.slice(0, -1))}${inflections}`;
          endingBoundary = '(?=$|[^A-Za-z0-9А-Яа-я])';
        } else {
          endingBoundary = '(?=$|[^A-Za-z0-9А-Яа-я]|(?:ом|а|у|е|ы|и|ой|ым|ого|ому))';
        }
      }
      const expression = new RegExp(`(?<![A-Za-z0-9А-Яа-я])${aliasPattern}${endingBoundary}`, 'ig');
      for (const match of text.matchAll(expression)) {
        const key = `${champion.slug}:${match.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ champion, alias, match });
      }
    }
  }
  return matches.sort((left, right) => left.match.index - right.match.index);
}

function getSkinTableFlags(text, hasSkinTable) {
  const shortSkinTitle = hasSkinTable && !/[.!?]/.test(text) && text.split(/\s+/).length <= 8;
  const tableSkin = hasSkinTable && (SKIN_RELEASE_CAPTION_PATTERN.test(text) || shortSkinTitle);
  const passSkin = /(?:wild pass|mini pass).{0,120}(?:arrives?|premieres?|featuring|starring)|(?:arrives?|premieres?).{0,120}(?:wild pass|mini pass).{0,120}(?:featuring|starring)/i.test(text);
  return { tableSkin, passSkin };
}

function makeSkinTableChange(text, matchData, tableSkin, sourceImageUrl, locale) {
  const { champion, alias, match } = matchData;
  if (/(?:has arrived on the rift|arrives on the rift|прибывает в ущелье|прибывает на рифт)/i.test(text)
    && !/(?:skin|облик|образ|скин)/i.test(text)) return null;
  let title = cleanSkinTitle(tableSkin
    ? stripSkinReleaseCaption(text)
    : extractSkinName(text, alias, match.index, false, match[0]));
  const titleChampionToken = title?.match(/[\p{L}][\p{L}\p{M}'’.-]*$/u)?.[0];
  if (title && (matchData.typo || (titleChampionToken
    && normalizeSkinTypoToken(titleChampionToken) === normalizeSkinTypoToken(alias)))) {
    title = title.replace(/[\p{L}][\p{L}\p{M}'’.-]*$/u, formatSkinChampionAlias(alias));
  }
  if (!title) return null;
  if (champion.aliases?.some((alias) => normalizeEntityName(title) === normalizeEntityName(alias))) return null;
  if (isAnnouncementChestSkinMention(text)) return null;
  const returning = /return(?:ing)?|returns|возвраща|повторн/i.test(text);
  const chroma = /\((?:pink|yellow|amber|purple)\)|\bchroma\b|хроматик/i.test(title);
  return {
    entityKind: 'skin',
    entityName: getCanonicalSkinName(champion.slug, title, locale),
    entitySlug: getCanonicalAnnouncementSkinSlug(champion.slug, title),
    sourceChampionSlug: champion.slug,
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
    changeName: returning ? 'returning' : chroma || isColorVariant(title) ? 'available' : 'new',
    sectionName: getPatchSkinSectionName(locale, returning, true),
    details: [{
      label: null,
      before: null,
      after: null,
      text: tableSkin ? getSkinReleaseDetail(text, locale) || getPatchSkinAvailabilityText(locale, true) : text,
    }],
  };
}

function formatSkinChampionAlias(alias) {
  const value = cleanText(alias);
  if (!value || value !== value.toLocaleUpperCase()) return value;
  return value.toLocaleLowerCase().replace(/(^|[\s'’-])([\p{L}])/gu, (_, separator, letter) => (
    `${separator}${letter.toLocaleUpperCase()}`
  ));
}

function parseSkinTableParagraph(text, champions, hasSkinTable, locale) {
  const { tableSkin, passSkin } = getSkinTableFlags(text, hasSkinTable);
  if (!tableSkin && !passSkin) return [];
  return findAllSkinAliasMatches(text, champions)
    .map((match) => makeSkinTableChange(text, match, tableSkin, null, locale))
    .filter(Boolean);
}

function parseSkinImageCell($, node, champions, locale) {
  const sourceImageUrl = safeRiotImageUrl($(node).find('img').first().attr('src'));
  if (!sourceImageUrl) return [];
  const caption = $(node).find('p').filter((_, paragraph) => !$(paragraph).find('img').length)
    .map((_, paragraph) => htmlToText(($(paragraph).html() || "").replace(/<br\s*\/?\s*>/gi, " "))).get().join(' ');
  return findImageBackedSkinMatches(caption, champions)
    .map((match) => makeSkinTableChange(caption, match, true, sourceImageUrl, locale))
    .filter(Boolean);
}

function normalizeSkinTypoToken(value) {
  return normalizeEntityName(value).replace(/\s+/g, "");
}

function hasOneEditDifference(left, right) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const differences = [];
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences.push(index);
    }
    return differences.length === 1
      || (differences.length === 2
        && differences[1] === differences[0] + 1
        && left[differences[0]] === right[differences[1]]
        && left[differences[1]] === right[differences[0]]);
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longIndex += 1;
    }
  }
  return true;
}

function findImageBackedSkinMatches(text, champions) {
  const title = cleanSkinTitle(stripSkinReleaseCaption(text));
  const exactMatches = findAllSkinAliasMatches(title, champions);
  if (exactMatches.length) return exactMatches;

  const lastWord = title.match(/[\p{L}][\p{L}\p{M}'’.-]*$/u)?.[0];
  const normalizedLastWord = lastWord && normalizeSkinTypoToken(lastWord);
  if (!normalizedLastWord || normalizedLastWord.length < 5) return [];
  const candidates = new Map();
  for (const champion of champions) {
    const aliases = champion.aliases.filter((alias) => !/\s/.test(alias)
      && normalizeSkinTypoToken(alias).length >= 5
      && hasOneEditDifference(normalizedLastWord, normalizeSkinTypoToken(alias)));
    if (!aliases.length) continue;
    const canonicalAlias = champion.aliases.find((alias) => /^[a-z][a-z'’.-]*$/i.test(alias)) || champion.name;
    candidates.set(champion.slug, { champion, alias: canonicalAlias, typo: true });
  }
  if (candidates.size !== 1) return [];
  return [...candidates.values()].map((candidate) => ({
    ...candidate,
    match: { index: title.length - lastWord.length, 0: lastWord },
  }));
}

function parseSkinTableChanges(blades, catalog, locale) {
  const champions = uniqueChampions(catalog);
  const changes = [];
  const parsedImageCellParagraphs = new WeakSet();
  let inSkinSection = false;
  let activeChromaCollection = null;
  const chromaCollections = new Map();
  for (const blade of Array.isArray(blades) ? blades : []) {
    const html = sanitizeRichText(extractRichText(blade));
    const $ = load(`<div>${html}</div>`, null, false);
    const nodes = $.root().children().first().find('h2,h3,h4,h5,tr,td,p,li').toArray();
    for (const node of nodes) {
      const tag = String(node.tagName || '').toLowerCase();
      const text = cleanText($(node).text());
      if (!text) continue;
      if (['h2', 'h3', 'h4', 'h5'].includes(tag)) {
        if (/^(?:skins?|облики|образы)$/i.test(text)) inSkinSection = true;
        else if (tag === 'h2') inSkinSection = false;
        activeChromaCollection = null;
        continue;
      }
      if (tag === 'tr') {
        const collection = getSkinChromaCollectionFromTable($, node, champions, locale);
        if (collection) {
          const key = `${collection.sourceChampionSlug}:${normalizeEntityName(collection.entityName)}`;
          activeChromaCollection = chromaCollections.get(key) || collection;
          if (!chromaCollections.has(key)) {
            chromaCollections.set(key, collection);
            changes.push({
              entityKind: 'skin',
              entityName: collection.entityName,
              entitySlug: collection.entitySlug,
              sourceChampionSlug: collection.sourceChampionSlug,
              changeName: 'available',
              sectionName: locale === 'ru-ru' ? 'Облики патча' : 'Patch Skins',
              details: [],
            });
          }
        }
        changes.push(...parseSkinProbabilityRow($, node, champions, locale, activeChromaCollection));
        continue;
      }
      if (tag === 'td' && inSkinSection) {
        const cellChanges = parseSkinImageCell($, node, champions, locale);
        changes.push(...cellChanges);
        if (cellChanges.length) {
          for (const paragraph of $(node).find('p,li').toArray()) parsedImageCellParagraphs.add(paragraph);
        }
        continue;
      }
      if (['p', 'li'].includes(tag)) {
        if (parsedImageCellParagraphs.has(node)) continue;
        const paragraph = htmlToText($(node).html().replace(/<br\s*\/?\s*>/gi, ' '));
        changes.push(...parseSkinTableParagraph(paragraph, champions, inSkinSection, locale));
        if (activeChromaCollection && isChromaLootDetailParagraph(paragraph)) {
          changes.push({
            entityKind: 'skin',
            entityName: activeChromaCollection.entityName,
            entitySlug: activeChromaCollection.entitySlug,
            sourceChampionSlug: activeChromaCollection.sourceChampionSlug,
            changeName: 'available',
            sectionName: locale === 'ru-ru' ? 'Облики патча' : 'Patch Skins',
            details: [{ label: null, before: null, after: null, text: paragraph }],
          });
        }
      }
    }
  }
  return changes;
}

function isChromaChestHeader(value) {
  return /(?:chromas?[^.!?]{0,50}chest|chest[^.!?]{0,50}chromas?|сундук[^.!?]{0,80}(?:цветов\p{L}*\s+схем|хромат)|(?:цветов\p{L}*\s+схем|хромат)[^.!?]{0,80}сундук)/iu.test(value);
}

function getSkinChromaCollectionFromTable($, row, champions, locale) {
  const table = $(row).closest('table');
  if (!table.length) return null;
  const header = table.find('thead tr').first().length
    ? table.find('thead tr').first()
    : table.find('tr').first();
  const headerTitle = cleanText(header.children('th,td').first().text());
  if (!isChromaChestHeader(headerTitle)) return null;

  const quotedSkin = headerTitle.match(/["“«]([^"”»]+)["”»]/)?.[1];
  let skinTitle = cleanText(quotedSkin || headerTitle);
  if (!quotedSkin) {
    skinTitle = skinTitle
      .replace(/\s+(?:(?:random|lucky)\s+)?chroma(?:\s+(?:random|lucky))?\s+chest\s*$/iu, '')
      .replace(/^(?:lucky|random)\s+chroma\s+chest\s+(?:for|of)\s+/iu, '')
      .replace(/^(?:(?:счастлив\p{L}*|случайн\p{L}*)\s+)?сундук\s+(?:со\s+случайн\p{L}*\s+)?с?\s*цветов\p{L}*\s+схем\p{L}*\s*/iu, '');
  }
  const matchData = findAllSkinAliasMatches(skinTitle, champions)[0];
  if (!matchData) return null;
  const baseSkinName = cleanSkinTitle(extractSkinName(
    skinTitle,
    matchData.alias,
    matchData.match.index,
    false,
    matchData.match[0],
    locale,
  ));
  if (!baseSkinName || matchData.champion.aliases?.some((alias) => (
    normalizeEntityName(baseSkinName) === normalizeEntityName(alias)
  ))) return null;

  const familyName = locale === 'ru-ru'
    ? `${baseSkinName} (цветовые схемы)`
    : `${baseSkinName} chromas`;
  const entityName = getCanonicalSkinName(matchData.champion.slug, familyName, locale);
  const tableHeaderText = cleanText(header.text());
  return {
    entityName,
    entitySlug: getCanonicalAnnouncementSkinSlug(matchData.champion.slug, entityName),
    sourceChampionSlug: matchData.champion.slug,
    isLuckyChest: /(?:lucky\s+chroma\s+chest|chroma\s+lucky\s+chest|счастлив\p{L}*\s+сундук)/iu.test(tableHeaderText),
  };
}

function isChromaLootDetailParagraph(value) {
  return /^(?:availability|доступность)\s*:/iu.test(value)
    || /(?:\bchests?\b|сундук|сокровищниц|хроматик|цветов\p{L}*\s+схем)/iu.test(value);
}

function parseSkinProbabilityRow($, row, champions, locale, chromaCollection = null) {
  const cells = $(row).children('td,th').toArray();
  if (cells.length < 2) return [];
  const skinName = cleanText($(cells[0]).text());
  const probability = cleanText($(cells[1]).text());
  if (!skinName || !/\d+(?:[.,]\d+)?\s*%/.test(probability)) return [];
  const matches = findAllSkinAliasMatches(skinName, champions);
  if (chromaCollection && (/(?:\bchests?\b|сундук|сокровищниц)/iu.test(skinName)
    || (chromaCollection.isLuckyChest && !matches.length))) {
    return [{
      entityKind: 'skin',
      entityName: chromaCollection.entityName,
      entitySlug: chromaCollection.entitySlug,
      sourceChampionSlug: chromaCollection.sourceChampionSlug,
      changeName: 'available',
      sectionName: locale === 'ru-ru' ? 'Облики патча' : 'Patch Skins',
      details: [{
        label: locale === 'ru-ru' ? 'Шанс выпадения из счастливого сундука' : 'Lucky-chest reward chance',
        before: null,
        after: probability,
        text: `${skinName}: ${probability}`,
      }],
    }];
  }
  if (/(?:\bchests?\b|сундук|сокровищниц)/iu.test(skinName)) return [];
  return matches
    .filter(({ alias }) => normalizeEntityName(skinName) !== normalizeEntityName(alias))
    .map(({ champion }) => ({
      entityKind: 'skin',
      entityName: getCanonicalSkinName(champion.slug, skinName, locale),
      entitySlug: getCanonicalAnnouncementSkinSlug(champion.slug, skinName),
      sourceChampionSlug: champion.slug,
      changeName: 'available',
      sectionName: locale === 'ru-ru' ? 'Облики патча' : 'Patch Skins',
      details: [{
        label: locale === 'ru-ru' ? 'Шанс выпадения' : 'Drop chance',
        before: null,
        after: probability,
        text: `${skinName}: ${probability}`,
      }],
    }));
}
function parseCharacterChanges(blade) {
  const entries = Array.isArray(blade.characters) ? blade.characters : [];
  return entries.flatMap((entry) => {
    const character = entry?.character || entry || {};
    const name = cleanText(character.name || entry?.name || entry?.title);
    if (!name) return [];
    const summary = sanitizeRichText(entry?.summary?.body || "");
    const championImageUrl = safeRiotImageUrl(character.media?.url);
    const changes = (Array.isArray(entry?.changes) ? entry.changes : [])
      .filter((change) => change?.description?.body || change?.descriptionText)
      .map((change) => {
        const title = cleanText(change.title || "General");
        const body = sanitizeRichText(change.description?.body || change.descriptionText || "");
        const iconUrl = safeRiotImageUrl(change.icon?.url);
        const icon = iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy">` : "";
        return `<h3>${escapeHtml(title)}</h3>${icon}${body}`;
      });
    if (!summary && !changes.length) return [];
    return [{
      kind: "champion",
      heading: name,
      imageUrl: championImageUrl,
      summary: htmlToText(summary).slice(0, 260),
      html: `${summary}${changes.join("")}`,
    }];
  });
}

function isChampionBaseStatsHeading(value) {
  const heading = cleanText(value).replace(/[_-]+/g, " ");
  return /^(?:(?:base|basic|champion)\s+stats(?:\s+and\s+(?:growth|scaling))?|(?:base|basic|champion)\s+attributes|(?:основные|базовые|чемпионские)\s+(?:показатели|характеристики))$/i
    .test(heading);
}

function parseChampionSnapshotStatRows(description) {
  const html = sanitizeRichText(description?.body || description || "");
  if (!html) return [];
  const $ = load(`<div>${html}</div>`, null, false);
  return $.root().children().first().find("li").toArray().flatMap((node) => {
    const sourceText = directListItemText(node, $);
    if (!sourceText || /^\[(?:removed|deleted|удал[её]но)\]\s*/i.test(sourceText)) return [];
    const text = sourceText.replace(/^\[(?:new|added|новое|добавлено)\]\s*/i, "");
    const parsed = parseChangeLine(text);
    const colon = text.indexOf(":");
    if (colon <= 0) return [];
    const label = cleanText(parsed.label || text.slice(0, colon));
    const value = cleanText(parsed.after || text.slice(colon + 1));
    if (!label || !value) return [];
    return [{ label, value, sourceText }];
  });
}

function extractChampionStatSnapshots(blades, catalog, locale, patchVersion, sourceUrl) {
  const snapshots = new Map();
  for (const blade of Array.isArray(blades) ? blades : []) {
    if (blade?.type !== "characterChanges") continue;
    const sectionName = cleanText(blade.fragmentId || blade.title || "Champion Stats");
    for (const entry of Array.isArray(blade.characters) ? blade.characters : []) {
      const character = entry?.character || entry || {};
      const sourceName = cleanText(character.name || entry?.name || entry?.title);
      if (!sourceName) continue;
      const mention = findCatalogChampionHeading(sourceName, catalog);
      const champion = getCatalogEntity("champion", sourceName, catalog) || mention?.entity;
      const entityName = getLocalizedChampionHeadingName(sourceName, mention, champion, sourceName, locale);
      const statRows = (Array.isArray(entry?.changes) ? entry.changes : []).flatMap((change) => (
        isChampionBaseStatsHeading(change?.title)
          ? parseChampionSnapshotStatRows(change?.description)
          : []
      ));
      if (!statRows.length) continue;
      const key = champion?.slug || normalizeEntityName(entityName);
      let snapshot = snapshots.get(key);
      if (!snapshot) {
        snapshot = {
          patchVersion,
          locale,
          sourceUrl,
          entityKind: "champion",
          entityName,
          ...(champion?.slug ? { entitySlug: champion.slug } : {}),
          sourceSections: [],
          stats: new Map(),
        };
        snapshots.set(key, snapshot);
      }
      if (!snapshot.sourceSections.includes(sectionName)) snapshot.sourceSections.push(sectionName);
      for (const stat of statRows) snapshot.stats.set(normalizeEntityName(stat.label), stat);
    }
  }
  return Array.from(snapshots.values()).map((snapshot) => ({
    ...snapshot,
    stats: Array.from(snapshot.stats.values()),
  }));
}

function buildContentSection(heading, sourceHtml) {
  const html = sanitizeRichText(sourceHtml);
  return { summary: htmlToText(html).slice(0, 260), html };
}

function safeRiotImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cmsassets.rgpub.io" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeRiotArticleIdentityUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "wildrift.leagueoflegends.com") return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export function isProvenRiotArticleAlias(page, title, expectedVersion, sourceAlias) {
  if (!sourceAlias || sourceAlias.patchVersion !== expectedVersion) return false;

  const pageUrl = normalizeRiotArticleIdentityUrl(page.url || "");
  const articleUrl = normalizeRiotArticleIdentityUrl(sourceAlias.articleUrl || "");
  const provenanceUrl = normalizeRiotArticleIdentityUrl(sourceAlias.provenanceUrl || "");
  if (!pageUrl || pageUrl !== articleUrl || pageUrl !== provenanceUrl) return false;
  const pathname = new URL(pageUrl).pathname;
  if (!/^\/[a-z]{2}-[a-z]{2}\/news\/(?:game-updates|dev)\/[^/]+$/i.test(pathname)) return false;
  // An audited alias is valid only when the official article's URL and title
  // independently identify the same unnumbered article.
  return normalizeEntityName(pathname.split("/").at(-1)) === normalizeEntityName(title);
}

function isOfficialRiotRussianPatchUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.toLowerCase() === "wildrift.leagueoflegends.com"
      && /^\/ru-ru\/news\/(?:game-updates|dev)\/(?:wild-rift-(?:patch-notes|patch)-[a-z0-9-]+|opisanie-obnovleniya-[a-z0-9-]+-dlya-wild-rift)\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function getPatchArticleIdentity(page, expectedVersion, locale, sourceAlias = null) {
  const masthead = page.blades.find((blade) => blade?.type === "articleMasthead");
  const title = cleanText(masthead?.title || page.title);
  const titleVersion = extractPatchVersion(title, "");
  const urlVersion = extractPatchVersion("", page.url || "");
  const detectedVersion = titleVersion || urlVersion;
  const aliased = !detectedVersion && isProvenRiotArticleAlias(page, title, expectedVersion, sourceAlias);
  const ruTitleConfirmsVersionedUrl = locale === "ru-ru"
    && titleVersion === expectedVersion
    && urlVersion !== expectedVersion
    && isOfficialRiotRussianPatchUrl(page.url);
  if (!title || (titleVersion && urlVersion && titleVersion !== urlVersion && !ruTitleConfirmsVersionedUrl)
    || (detectedVersion && detectedVersion !== expectedVersion) || (!detectedVersion && !aliased)) {
    throw new Error(`Riot article version mismatch (expected ${expectedVersion}, found ${detectedVersion || "none"})`);
  }
  return { masthead, title, version: detectedVersion || expectedVersion };
}

function parsePatchChanges(blades, catalog, locale) {
  const changes = mergeSkinChangeRows([
    ...parseStructuredChanges(blades, catalog, locale),
    ...parseAnnouncementChanges(blades, catalog, locale),
    ...parseSkinTableChanges(blades, catalog, locale),
  ]).filter((change) => (change.scope?.type === "game-mode" || !isGameModeChange(change))
    && !(change.entityKind === "skin" && (String(change.entityName || "").length > 100 || isSkinSectionHeading(change.entityName))));
  return changes;
}

function getPatchChampionMentions(catalog, searchable) {
  const matches = new Map();
  for (const champion of catalog?.champions?.values() || []) {
    if (!champion?.slug) continue;
    const aliases = [champion.name, ...(Array.isArray(champion.aliases) ? champion.aliases : [])]
      .map(normalizeEntityName)
      .filter((alias) => alias.length >= 2);
    const mentions = Math.max(0, ...aliases.map((alias) => searchable.split(` ${alias} `).length - 1));
    if (mentions) matches.set(champion.slug, { champion, mentions, aliases });
  }
  const ranked = [...matches.values()].sort((left, right) => right.mentions - left.mentions);
  return ranked.length && ranked[0].mentions >= 2 && ranked[0].mentions !== ranked[1]?.mentions ? ranked[0] : null;
}

function patchChampionSectionText(blocks, index, headingLevel, $) {
  const text = [];
  for (let next = index + 1; next < blocks.length; next += 1) {
    const tag = String(blocks[next].tagName || "").toLowerCase();
    if (/^h[1-5]$/.test(tag) && Number(tag.slice(1)) <= headingLevel) break;
    if (["p", "li"].includes(tag)) text.push(cleanText($(blocks[next]).text()));
  }
  return ` ${normalizeEntityName(text.join(" "))} `;
}

function newChampionMentionRows(blades, catalog, locale) {
  const rows = [];
  for (const blade of blades || []) {
    if (!/^(?:articleRichText|patchNotesRichText)$/.test(blade?.type || "")) continue;
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const blocks = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray();
    blocks.forEach((heading, index) => {
      const tag = String(heading.tagName || "").toLowerCase();
      const level = Number(tag.slice(1));
      const sectionName = cleanText($(heading).text());
      if (!/^h[1-5]$/.test(tag) || getCategoryHeading(sectionName) !== "champion"
        || getCategoryMarker(sectionName) !== "new") return;
      const searchable = patchChampionSectionText(blocks, index, level, $);
      const match = getPatchChampionMentions(catalog, searchable);
      if (!match || rows.some((row) => row.entitySlug === match.champion.slug)) return;
      const sourceAlias = (match.champion.aliases || []).find((alias) => searchable.includes(` ${normalizeEntityName(alias)} `));
      rows.push({
        entityKind: "champion",
        entitySlug: match.champion.slug,
        entityName: locale === "ru-ru" ? sourceAlias || match.champion.name : match.champion.name,
        sectionName,
        changeName: "new",
        details: [{ label: null, before: null, after: null, text: locale === "ru-ru" ? "Новый чемпион." : "New champion." }],
      });
    });
  }
  return rows;
}

function isSkinSectionHeading(value) {
  return /^(?:(?:new|returning|available|повторные|новые)?\s*(?:skins?|облики|образы))(?:\s+(?:wild pass|mini pass|пропуска|пропусков))?$/i
    .test(cleanText(value));
}

function isModeSpecificSystemDetail(detail) {
  const details = String(detail || "");
  const mode = /\b(?:aaa\s*aram|aram|arena|battlefest|sonic waves|training camp)\b|арен[аы]|отвязное безумие|тренировочн\p{L}* площадк/iu;
  const modeContext = /\b(?:only|specific to|while playing|in|for|during)\s+(?:the\s+)?(?:aaa\s*)?(?:aram|arena|battlefest|sonic waves|training camp)\b|\b(?:aram|arena)\s+(?:mode|champion select|match|game)\b|только\s+(?:в|для)\s+(?:режиме\s+)?(?:aram|арен[аы])|в\s+режиме\s+(?:aram|арен[аы])/iu;
  return mode.test(details) && modeContext.test(details);
}

function isGameModeChange(change) {
  return /^(?:game mode changes|игровые режимы|приключенческий режим)$/i.test(change.sectionName || "")
    || isGameModeHeading(change.sectionName || "")
    || isGameModeHeading(change.entityName || "");
}

const KNOWN_SYSTEM_SECTIONS = [
  {
    slug: "bounty-system-update",
    en: "Bounty System Update",
    ru: "Изменения системы наград за голову",
    sectionEn: "Battlefield Adjustments",
    sectionRu: "Изменения на поле боя",
    componentsEn: ["Overview", "Positive Bounty", "Neutral", "Negative Bounty"],
    componentsRu: ["Общая информация", "Положительные награды", "Нейтральные награды", "Отрицательные награды"],
  },
  {
    slug: "ahri-asu",
    en: "Ahri VGU",
    ru: "ВТО Ари",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "soulflowers",
    en: "[Removed] Soulflowers",
    ru: "[Удалено] Цветы души",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
    changeName: "removed",
  },
  {
    slug: "item-data-tracking-system",
    en: "Item data Tracking System",
    ru: "Система отслеживания данных предметов",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "end-of-match-system-improvements",
    en: "End-of-Match system Improvements",
    ru: "Улучшения послеигровой статистики",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "champion-select-screen-optimization",
    en: "Champion Select Screen Optimization",
    ru: "Оптимизация экрана выбора чемпиона",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "in-game-shop-interface-improvements",
    en: "In-Game Shop interface Improvements",
    ru: "Улучшен интерфейс внутриигрового магазина",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "damage-amplification-mechanic-update",
    en: "Damage Amplification Mechanic Update",
    ru: "Обновлена механика увеличения урона",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "seasonal-rift-update",
    en: "Seasonal Rift Update",
    ru: "Новое время года в Ущелье",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "vision-score-system",
    en: "Vision Score System",
    ru: "Система показателя обзора",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "champion-displacement-interrupt-rule-update",
    en: "Champion Displacement Interrupt Rule Update",
    ru: "Обновление правил прерывания смещения чемпионов",
    sectionEn: "Other Adjustments",
    sectionRu: "Прочие изменения",
  },
  {
    slug: "honorary-medal-system",
    en: "HONORARY MEDAL SYSTEM",
    ru: "СИСТЕМА ПОЧЕТНЫХ МЕДАЛЕЙ",
    sectionEn: "SYSTEM",
    sectionRu: "ИГРОВЫЕ СИСТЕМЫ",
  },
  {
    slug: "omnichamp",
    en: "“Omnichamp”",
    ru: "Знаток чемпионов",
    sectionEn: "SYSTEM",
    sectionRu: "ИГРОВЫЕ СИСТЕМЫ",
  },
  {
    slug: "violation-penalty",
    en: "VIOLATION PENALTY",
    ru: "ШТРАФЫ ЗА НАРУШЕНИЯ",
    sectionEn: "SYSTEM",
    sectionRu: "ИГРОВЫЕ СИСТЕМЫ",
  },
  {
    slug: "auto-uninstallation-system",
    en: "Auto-uninstallation System",
    ru: "Система автоматического удаления ресурсов",
    sectionEn: "SYSTEM",
    sectionRu: "ИГРОВЫЕ СИСТЕМЫ",
  },
  {
    slug: "highlights-auto-uninstallation-feature",
    en: "Highlights Auto-uninstallation Feature",
    ru: "Функция автоматического удаления ярких моментов",
    sectionEn: "SYSTEM",
    sectionRu: "ИГРОВЫЕ СИСТЕМЫ",
  },
  {
    slug: "ranked-rules-for-sovereign-and-above",
    en: "RANKED RULES FOR SOVEREIGN AND ABOVE",
    ru: "РАНГОВЫЕ ПРАВИЛА ДЛЯ РАНГА СУВЕРЕН И ВЫШЕ",
    sectionEn: "SYSTEM ADJUSTMENTS",
    sectionRu: "ИЗМЕНЕНИЯ СИСТЕМ",
  },
  {
    slug: "cache-cleanup",
    en: "CACHE CLEANUP",
    ru: "ОЧИСТКА КЭША",
    sectionEn: "SYSTEM ADJUSTMENTS",
    sectionRu: "ИЗМЕНЕНИЯ СИСТЕМ",
  },
  {
    slug: "friendship-store",
    en: "FRIENDSHIP STORE",
    ru: "МАГАЗИН ДРУЖБЫ",
    sectionEn: "SYSTEM ADJUSTMENTS",
    sectionRu: "ИЗМЕНЕНИЯ СИСТЕМ",
  },
  {
    slug: "matchmaking-champion-score-cap",
    en: "MATCHMAKING CHAMPION SCORE CAP",
    ru: "МАКСИМУМ ОЧКОВ ЧЕМПИОНА ПРИ ПОДБОРЕ ИГРОКОВ",
    sectionEn: "SYSTEM ADJUSTMENTS",
    sectionRu: "ИЗМЕНЕНИЯ СИСТЕМ",
  },
  {
    slug: "ranked-reward",
    en: "RANKED REWARD",
    ru: "РАНГОВЫЕ НАГРАДЫ",
    sectionEn: "SYSTEM ADJUSTMENTS",
    sectionRu: "ИЗМЕНЕНИЯ СИСТЕМ",
  },
  {
    slug: "stellacore-stats",
    en: "STELLACORE STATS",
    ru: "ЗВЕЗДНЫЕ ЯДРА",
    sectionEn: "SYSTEM ADJUSTMENTS",
    sectionRu: "ИЗМЕНЕНИЯ СИСТЕМ",
  },
  {
    slug: "button-ui-skin-feature-optimization",
    en: "BUTTON UI SKIN FEATURE OPTIMIZATION",
    ru: "ОПТИМИЗАЦИЯ ОБРАЗОВ КНОПОК",
    sectionEn: "SYSTEM ADJUSTMENTS",
    sectionRu: "ИЗМЕНЕНИЯ СИСТЕМ",
  },
];

function matchKnownSystemSection(title, locale) {
  const russian = locale === "ru-ru";
  const normalizedTitle = normalizeEntityName(title);
  return KNOWN_SYSTEM_SECTIONS.find((row) => normalizeEntityName(russian ? row.ru : row.en) === normalizedTitle);
}

function isKnownSystemComponent(row, text, locale) {
  const names = locale === "ru-ru" ? row.componentsRu : row.componentsEn;
  return (names || []).some((name) => normalizeEntityName(name) === normalizeEntityName(text.replace(/[:：]$/, "")));
}

function collectKnownSystemSectionDetails($, nodes, startIndex, row, headingLevel, locale) {
  const details = [];
  let component = null;
  for (let index = startIndex + 1; index < nodes.length; index += 1) {
    const node = nodes[index];
    const tag = String(node.tagName || "").toLowerCase();
    const text = cleanText($(node).text());
    if (/^h[1-6]$/.test(tag)) {
      if (Number(tag.slice(1)) <= headingLevel) break;
      if (isKnownSystemComponent(row, text, locale)) component = text.replace(/[:：]$/, "");
      else details.push({ label: null, before: null, after: null, text, component });
      continue;
    }
    if (!["p", "li"].includes(tag) || !text) continue;
    if (isKnownSystemComponent(row, text, locale)) {
      component = text.replace(/[:：]$/, "");
      continue;
    }
    details.push({ label: null, before: null, after: null, text, component });
  }
  return details;
}

function addKnownSystemRows(changes, blades, locale) {
  const russian = locale === "ru-ru";
  const rowsBySlug = new Map(KNOWN_SYSTEM_SECTIONS.map((row) => [row.slug, row]));
  const rowDetails = new Map();
  for (const blade of blades || []) {
    const markup = sanitizeRichText(extractRichText(blade));
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const nodes = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray();
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const tag = String(node.tagName || "").toLowerCase();
      if (!/^h[1-6]$/.test(tag) && tag !== "p") continue;
      const row = matchKnownSystemSection(cleanText($(node).text()), locale);
      if (!row) continue;
      const headingLevel = /^h[1-6]$/.test(tag) ? Number(tag.slice(1)) : 2;
      const details = collectKnownSystemSectionDetails($, nodes, index, row, headingLevel, locale);
      if (details.length) rowDetails.set(row.slug, details);
    }
  }
  for (const [slug, details] of rowDetails) {
    const definition = rowsBySlug.get(slug);
    const entityName = russian ? definition.ru : definition.en;
    const existing = changes.find((change) => change.entityKind === "system"
      && (change.entitySlug === slug || normalizeEntityName(change.entityName) === normalizeEntityName(entityName)));
    const row = existing || { entityKind: "system" };
    Object.assign(row, {
      entityName,
      entitySlug: slug,
      changeName: definition.changeName || null,
      sectionName: russian ? definition.sectionRu : definition.sectionEn,
      details,
    });
    if (!existing) changes.push(row);
  }
}

function collectSystemHeadingDetails($, heading, catalog) {
  const details = [];
  const headingLevel = Number(String(heading.tagName || "").slice(1));
  const blocks = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray();
  let nestedChampionLevel = null;
  let component = null;
  for (let sibling = $(heading).next(); sibling.length; sibling = sibling.next()) {
    const tag = String(sibling[0].tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      if (level <= headingLevel) break;
      if (nestedChampionLevel !== null && level <= nestedChampionLevel) nestedChampionLevel = null;
      const title = cleanText($(sibling).text());
      const champion = getCatalogEntity("champion", title, catalog)
        || findCatalogChampionHeading(title, catalog)?.entity;
      const blockIndex = blocks.indexOf(sibling[0]);
      if (nestedChampionLevel === null && champion?.slug && blockIndex >= 0
        && hasInlineChampionChangeAhead(blocks, blockIndex, level, catalog, $)) {
        nestedChampionLevel = level;
        continue;
      }
      if (nestedChampionLevel !== null) continue;
      component = cleanText(sibling.text());
      continue;
    }
    if (nestedChampionLevel !== null) continue;
    const contentNodes = ["ul", "ol"].includes(tag) ? sibling.find("li").toArray() : [sibling[0]];
    for (const node of contentNodes) {
      if (!["p", "li"].includes(String(node.tagName || "").toLowerCase())) continue;
      const text = patchArticleNodeText(node, $);
      if (text) details.push(...parseRichTextDetail(text).map((detail) => (
        component ? { ...detail, component } : detail
      )));
    }
  }
  return details;
}

function mergeSystemHeadingRow(changes, candidate) {
  const existing = changes.find((change) => change.entityKind === "system"
    && normalizeEntityName(change.entityName) === normalizeEntityName(candidate.entityName));
  if (!existing) {
    changes.push(candidate);
    return;
  }
  if (!existing.entitySlug && candidate.entitySlug) existing.entitySlug = candidate.entitySlug;
  if (!existing.sectionName && candidate.sectionName) existing.sectionName = candidate.sectionName;
  const nextEntityHeading = (candidate.details || []).findIndex((detail) => changes.some((change) => change !== existing
    && change.entityKind === "system"
    && normalizeEntityName(change.entityName) === normalizeEntityName(detail.text)));
  const candidateDetails = nextEntityHeading < 0 ? candidate.details || [] : candidate.details.slice(0, nextEntityHeading);
  for (const detail of candidateDetails) {
    if (!(existing.details || []).some((row) => normalizeEntityName(row.text) === normalizeEntityName(detail.text))) {
      existing.details ||= [];
      existing.details.push(detail);
    }
  }
}

function formatHeadingDisplayName(value, locale) {
  const text = cleanText(value);
  if (!/[\p{L}]/u.test(text) || text !== text.toLocaleUpperCase(locale)) return text;
  const lower = text.toLocaleLowerCase(locale);
  const formatted = locale === "ru-ru"
    ? `${lower[0]?.toLocaleUpperCase(locale) || ""}${lower.slice(1)}`
    : lower.replace(/\b[a-z]/g, (letter) => letter.toLocaleUpperCase(locale));
  return (text.match(/\b[A-Z0-9]{2,}\b/g) || []).reduce((result, acronym) => (
    result.replace(new RegExp(`\\b${escapeRegex(acronym)}\\b`, "i"), acronym)
  ), formatted);
}

const SYSTEM_ENTITY_SLUGS = new Map([
  ["red brambleback", "red-brambleback"],
  ["crest of cinders", "red-brambleback"],
  ["красный огнедрев", "red-brambleback"],
  ["battlefield tempo", "battlefield-tempo-adjustments"],
  ["battlefield tempo adjustments", "battlefield-tempo-adjustments"],
  ["темп сражения", "battlefield-tempo-adjustments"],
  ["изменения темпа матча", "battlefield-tempo-adjustments"],
]);

function getSystemEntitySlug(title) {
  return SYSTEM_ENTITY_SLUGS.get(normalizeEntityName(stripEntityMarker(title)));
}

function isMinionHeading(value, locale) {
  const names = locale === "ru-ru"
    ? ["Миньон-воин", "Миньон-маг", "Миньон с пушкой", "Осадный миньон", "Суперминьон"]
    : ["Melee Minion", "Caster Minion", "Cannon Minion", "Siege Minion", "Super Minion"];
  return names.some((name) => normalizeEntityName(value) === normalizeEntityName(name));
}

function createSystemHeadingContext(blade, locale) {
  const fragmentId = cleanText(blade.fragmentId || "");
  const fragmentSuggestsSystems = /systems?|gameplay|battlefield|other adjustments|прочие правки|систем|игрового процесса|поля боя/i.test(fragmentId);
  return {
    fragmentSuggestsSystems,
    sectionLevel: null,
    sectionName: fragmentId || (locale === "ru-ru" ? "Прочие изменения" : "Other Adjustments"),
    ignoredModeLevel: null,
    categoryStack: [],
  };
}

function advanceSystemHeadingContext(context, title, level) {
  context.ignoredModeLevel = advanceIgnoredGameModeScope(title, level, context.ignoredModeLevel);
  context.categoryStack = context.categoryStack.filter((entry) => entry.level < level);
  if (isGameModeChangesHeading(title)) {
    context.ignoredModeLevel = level;
    context.sectionLevel = null;
    context.categoryStack = [];
    return false;
  }
  if (context.ignoredModeLevel !== null) {
    context.sectionLevel = null;
    return false;
  }
  const category = getArticleHeadingCategoryKind(title);
  if (category) {
    context.categoryStack.push({ level, kind: category, name: title });
    context.sectionLevel = category === "system" ? level : null;
    if (context.sectionLevel !== null) context.sectionName = title;
    return false;
  }
  const activeCategory = context.categoryStack.at(-1);
  if (activeCategory) {
    context.sectionLevel = activeCategory.kind === "system" ? activeCategory.level : null;
    if (activeCategory.kind !== "system") return false;
    context.sectionName = activeCategory.name;
    return level > context.sectionLevel;
  }
  context.sectionLevel = null;
  return context.fragmentSuggestsSystems;
}

function addSystemRowsFromHeadings(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const context = createSystemHeadingContext(blade, locale);
    const headings = $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray();
    for (const [index, heading] of headings.entries()) {
      const title = cleanText($(heading).text());
      const level = Number(String(heading.tagName || "").slice(1));
      const isStructuralCategory = level <= 2
        && headingHasFollowingEntityCategory(headings, index, $, level);
      if (getCategoryHeading(title) === "system" && !isStructuralCategory) {
        const details = collectSystemHeadingOwnDetails($, heading);
        if (details.length) mergeSystemHeadingRow(changes, {
          entityKind: "system",
          entityName: formatHeadingDisplayName(stripEntityMarker(title), locale),
          ...(getSystemEntitySlug(title) ? { entitySlug: getSystemEntitySlug(title) } : {}),
          changeName: getEntityMarker(title),
          sectionName: context.sectionName,
          details,
        });
      }
      if (!advanceSystemHeadingContext(context, title, level)) continue;
      if (isMinionHeading(title, locale)) continue;
      const details = collectSystemHeadingDetails($, heading, catalog);
      if (!details.length) continue;
      mergeSystemHeadingRow(changes, {
        entityKind: "system",
        entityName: formatHeadingDisplayName(stripEntityMarker(title), locale),
        ...(getSystemEntitySlug(title) ? { entitySlug: getSystemEntitySlug(title) } : {}),
        changeName: getEntityMarker(title),
        sectionName: context.sectionName,
        details,
      });
    }
  }
}

function isSupplementalSystemSectionHeading(title, details) {
  const heading = cleanText(title);
  if (hasSupplementalSystemHeadingSignal(heading)) return true;
  if ((details || []).some((detail) => detail.before && detail.after)) return true;

  const body = (details || []).map((detail) => detail.text || "").join(" ");
  const bodySignals = /\b(?:calculated?|calculation|refresh(?:ed|es)?|settlement|schedule|rankings?|standings?|deadline|rollover|reset|weekly|daily|every\s+(?:day|week|month|sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b|рассчитыва|расч[её]т|обновля|расписан|ежедневно|еженедельно|кажд(?:ый|ую|ое|ую|ом)\s+(?:день|неделю|месяц)|сроки|сбрасыва/iu;
  return bodySignals.test(body);
}

function isNewContentHeading(title) {
  return /^(?:new(?:\s+(?:content|features?))?|нов(?:ое|ые|ый|ая)(?:\s+(?:содержимое|функции))?)$/iu.test(cleanText(title));
}

function isAggregateItemAdjustmentHeading(value) {
  const title = cleanText(value);
  return /^all\b.+\bitems?\s+(?:adjustments?|changes?|updates?)$/iu.test(title)
    || /^(?:все\s+)?(?:изменени[яе]|корректировк[аи]|обновлени[яе]).{0,70}предмет[а-яё]*/iu.test(title);
}

function hasSupplementalSystemHeadingSignal(title) {
  return /\b(?:systems?|systematic|rules?|leaderboards?|rankings?|settlement|schedules?|timing|calculations?|refresh|rollover|optimization|optimisation|improvements?|progression|eligibility|penalties|restrictions|controls?|settings?|ranked|queue|rift|dragons?|aram|hotfix(?:es)?|bug\s*fix(?:es)?)\b|систем|правил|таблиц\s+лидер|рейтинг|рангов|очеред|расписан|график|расч[её]т|обновлен|оптимизац|улучшен|прогресс|начислен|штраф|ограничен|управлен|настройк|ущель|дракон|арам|исправлен|^изменения\s+от\s+\d{1,2}\s+[а-яё]+$/iu
    .test(cleanText(title));
}

function addSupplementalSystemRowsFromHeadings(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    if (!/^(?:articleRichText|patchNotesRichText)$/.test(blade?.type || "")) continue;
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const context = createSystemHeadingContext(blade, locale);
    const fragmentCategory = getCategoryHeading(cleanText(blade.fragmentId || "").replace(/[-_]+/g, " "));
    const headings = $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray();
    let articleSectionSeen = Boolean(fragmentCategory);
    let recognizedSectionLevel = fragmentCategory ? 0 : null;
    let recognizedSectionKind = fragmentCategory;
    let recognizedSectionName = cleanText(blade.fragmentId || "");
    let systemSectionLevel = fragmentCategory === "system" ? 0 : null;
    let ignoredModeLevel = null;
    let newContentSectionLevel = null;
    let newContentSectionName = null;

    for (const heading of headings) {
      const title = cleanText($(heading).text());
      const level = Number(String(heading.tagName || "").slice(1));
      ignoredModeLevel = advanceIgnoredGameModeScope(title, level, ignoredModeLevel);
      if (isGameModeChangesHeading(title)) {
        ignoredModeLevel = level;
        continue;
      }
      if (ignoredModeLevel !== null) continue;

      const category = getCategoryHeading(title);
      if (isAggregateItemAdjustmentHeading(title)) {
        const details = collectSystemHeadingOwnDetails($, heading);
        if (details.some((detail) => detail.before && detail.after)) {
          mergeSystemHeadingRow(changes, {
            entityKind: "system",
            entityName: formatHeadingDisplayName(stripEntityMarker(title), locale),
            changeName: getEntityMarker(title),
            sectionName: recognizedSectionName || (locale === "ru-ru" ? "Изменения предметов" : "Item Adjustments"),
            details,
          });
        }
        recognizedSectionLevel = level;
        recognizedSectionKind = category || "item";
        recognizedSectionName = title;
        continue;
      }
      if (level <= 2) {
        articleSectionSeen = true;
        newContentSectionLevel = isNewContentHeading(title) ? level : null;
        newContentSectionName = newContentSectionLevel === null ? null : title;
        recognizedSectionLevel = category ? level : null;
        recognizedSectionKind = category;
        if (category) recognizedSectionName = title;
        systemSectionLevel = category === "system" ? level : null;
        if (category) continue;
      } else if (recognizedSectionLevel !== null) {
        if (level <= recognizedSectionLevel) {
          recognizedSectionLevel = null;
          recognizedSectionKind = null;
        } else if (recognizedSectionKind !== "system" && systemSectionLevel === null
          && !hasSupplementalSystemHeadingSignal(title)) {
          continue;
        }
      }

      if (category) {
        recognizedSectionLevel = level;
        recognizedSectionKind = category;
        recognizedSectionName = title;
        systemSectionLevel = category === "system" ? level : null;
        continue;
      }

      // Riot can put an unclassified topic directly into a rich-text blade
      // without an enclosing category. Recover its numeric rows when the
      // heading is not a catalog entity, including headings without a known
      // label, so a new system topic does not silently disappear.
      const isNewContentTopic = newContentSectionLevel !== null
        && level === newContentSectionLevel + 1
        && recognizedSectionLevel === null;
      const details = isNewContentTopic
        ? collectNewContentTopicDetails($, heading, catalog)
        : collectSystemHeadingDetails($, heading, catalog);
      const hasNumericDelta = details.some((detail) => detail.before && detail.after);
      const isKnownEntityHeading = ["champion", "item", "rune", "spell"].some((kind) => (
        getCatalogEntity(kind, title, catalog)
      )) || findCatalogChampionHeading(title, catalog);
      if (isKnownEntityHeading) continue;
      if (isNewContentTopic && changes.some((change) => change.entityKind === "system"
        && change.scope?.type === "game-mode"
        && normalizeEntityName(change.entityName) === normalizeEntityName(title))) continue;
      if (!articleSectionSeen && !hasSupplementalSystemHeadingSignal(title) && !hasNumericDelta) continue;
      if (level <= 2 && !hasSupplementalSystemHeadingSignal(title) && !hasNumericDelta) continue;
      if (!details.length || (!isNewContentTopic && !isSupplementalSystemSectionHeading(title, details))) continue;

      mergeSystemHeadingRow(changes, {
        entityKind: "system",
        entityName: formatHeadingDisplayName(stripEntityMarker(title), locale),
        changeName: getEntityMarker(title) || (isNewContentTopic ? "new" : null),
        sectionName: isNewContentTopic ? newContentSectionName : context.sectionName,
        details,
      });
    }
  }
}

function collectSystemHeadingOwnDetails($, heading) {
  const details = [];
  for (let sibling = heading.next; sibling; sibling = sibling.next) {
    const tag = String(sibling.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) break;
    const nodes = ["ul", "ol"].includes(tag) ? $(sibling).children("li").toArray() : [sibling];
    for (const node of nodes) {
      if (!["p", "li"].includes(String(node.tagName || "").toLowerCase())) continue;
      const text = patchArticleNodeText(node, $);
      if (text) details.push(...parseRichTextDetail(text));
    }
  }
  return details;
}

function collectNewContentTopicDetails($, heading, catalog) {
  const details = [];
  const headingLevel = Number(String(heading.tagName || "").slice(1));
  let ignoredCategoryLevel = null;
  let component = null;
  for (let sibling = heading.next; sibling; sibling = sibling.next) {
    const tag = String(sibling.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      if (level <= headingLevel) break;
      if (ignoredCategoryLevel !== null) {
        if (level <= ignoredCategoryLevel) ignoredCategoryLevel = null;
        else continue;
      }
      const title = cleanText($(sibling).text());
      const category = getCategoryHeading(title) || getArticleChangeKind(title);
      const isCatalogEntity = ["champion", "item", "rune", "spell", "skin"].some((kind) => (
        getCatalogEntity(kind, title, catalog)
      )) || findCatalogChampionHeading(title, catalog);
      if (isCatalogEntity || ["champion", "item", "rune", "spell", "skin"].includes(category)) {
        ignoredCategoryLevel = level;
        continue;
      }
      component = title;
      continue;
    }
    if (ignoredCategoryLevel !== null) continue;
    const contentNodes = ["ul", "ol"].includes(tag) ? $(sibling).find("li").toArray() : [sibling];
    for (const node of contentNodes) {
      if (!["p", "li"].includes(String(node.tagName || "").toLowerCase())) continue;
      const text = patchArticleNodeText(node, $);
      if (text) details.push(...parseRichTextDetail(text).map((detail) => (
        component ? { ...detail, component } : detail
      )));
    }
  }
  return details;
}

function parseSpellAdjustmentTitle(title, catalog, locale) {
  if (getCategoryHeading(title) !== "spell") return null;
  const name = cleanText(title
    .replace(/^(?:changes? to|изменени[яе])\s+/i, "")
    .replace(/\s*(?:adjustments?|changes?|корректировки|правки)\s*[:：]?$/i, ""));
  const titleWords = normalizeEntityName(name).split(" ");
  const spell = getCatalogEntity("spell", name, catalog)
    || Array.from(catalog?.spells?.entries() || []).find(([alias]) => {
      const normalizedAlias = normalizeEntityName(alias);
      const stem = normalizedAlias.replace(/[aeiouyаеёиоуыэюя]$/i, "");
      return titleWords.some((word) => word === normalizedAlias || (stem.length >= 3 && word.startsWith(stem)));
    })?.[1];
  if (!spell?.slug) return null;
  return {
    entityKind: "spell",
    entityName: getCatalogArticleName(name, "spell", catalog, spell.name || name, locale),
    entitySlug: spell.slug,
  };
}

function addCatalogSpellAdjustmentRows(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const context = createSystemHeadingContext(blade, locale);
    for (const heading of $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray()) {
      const title = cleanText($(heading).text());
      const level = Number(String(heading.tagName || "").slice(1));
      const candidate = parseSpellAdjustmentTitle(title, catalog, locale);
      if (candidate && context.ignoredModeLevel === null && context.sectionLevel !== null && level > context.sectionLevel)
        mergeCatalogSpellHeading(changes, candidate, collectSystemHeadingDetails($, heading, catalog), context.sectionName);
      advanceSystemHeadingContext(context, title, level);
    }
  }
}

function mergeCatalogSpellHeading(changes, candidate, details, sectionName) {
  if (!details.length) return;
  Object.assign(candidate, { sectionName, changeName: "adjustment", details });
  const existing = changes.find((change) => change.entityKind === "spell"
    && (change.entitySlug === candidate.entitySlug
      || normalizeEntityName(change.entityName) === normalizeEntityName(candidate.entityName)));
  if (!existing) {
    changes.push(candidate);
    return;
  }
  if (!existing.entitySlug) existing.entitySlug = candidate.entitySlug;
  for (const detail of details) {
    if (!existing.details.some((row) => normalizeEntityName(row.text) === normalizeEntityName(detail.text))) existing.details.push(detail);
  }
}

function addEmojiOnlyMinionChanges(changes, blades, locale) {
  const russian = locale === "ru-ru";
  const minions = russian ? [
    { heading: "Миньон-воин", entityName: "Миньон-воин" },
    { heading: "Миньон-маг", entityName: "Миньон-маг" },
    { heading: "Миньон с пушкой", entityName: "Миньон с пушкой" },
    { heading: "Осадный миньон", entityName: "Осадный миньон" },
    { heading: "Суперминьон", entityName: "Суперминьон" },
  ] : [
    { heading: "Melee Minion", entityName: "Melee Minion" },
    { heading: "Caster Minion", entityName: "Caster Minion" },
    { heading: "Cannon Minion", entityName: "Cannon Minion" },
    { heading: "Siege Minion", entityName: "Siege Minion" },
    { heading: "Super Minion", entityName: "Super Minion" },
  ];
  const emojiOnly = (text) => /\p{Extended_Pictographic}/u.test(text) && !/[\p{L}\p{N}]/u.test(text);
  const headings = new Map(minions.map((minion) => [normalizeEntityName(minion.heading), minion]));
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    let ignoredModeLevel = null;
    for (const heading of $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray()) {
      const title = cleanText($(heading).text());
      const level = Number(String(heading.tagName || "").slice(1));
      ignoredModeLevel = advanceMinionModeScope(title, level, ignoredModeLevel);
      if (ignoredModeLevel !== null) continue;
      const minion = headings.get(normalizeEntityName(title));
      if (!minion || changes.some((change) => change.entityKind === "system"
        && normalizeEntityName(change.entityName) === normalizeEntityName(minion.entityName))) continue;
      const details = [];
      let sibling = $(heading).next();
      while (sibling.length) {
        const tag = String(sibling[0].tagName || "").toLowerCase();
        const text = cleanText(sibling.text());
        if (/^h[2-5]$/.test(tag) && !emojiOnly(text)) break;
        if (["p", "li", "h4", "h5"].includes(tag) && emojiOnly(text)) {
          details.push({ label: null, before: null, after: null, text });
        }
        sibling = sibling.next();
      }
      if (!details.length) continue;
      changes.push({
        entityKind: "system",
        entityName: minion.entityName,
        sectionName: russian ? "Изменения игрового процесса" : "GAMEPLAY CHANGES",
        changeName: null,
        details,
      });
    }
  }
}

function advanceMinionModeScope(title, level, ignoredModeLevel) {
  return advanceIgnoredGameModeScope(title, level, ignoredModeLevel);
}

function isEmojiOnlyMinionRow(change, locale) {
  const names = locale === "ru-ru"
    ? ["Миньон-воин", "Миньон-маг", "Миньон с пушкой", "Осадный миньон", "Суперминьон"]
    : ["Melee Minion", "Caster Minion", "Cannon Minion", "Siege Minion", "Super Minion"];
  return change.entityKind === "system"
    && names.includes(change.entityName)
    && (change.details || []).length > 0;
}

function collectJungleMonsterDetailsFromHeading($, heading) {
  const details = [];
  let currentMonster = null;
  let hasExplanation = false;
  for (let sibling = $(heading).next(); sibling.length; sibling = sibling.next()) {
    const tag = String(sibling[0].tagName || "").toLowerCase();
    const headingTag = String(heading.tagName || "").toLowerCase();
    const headingLevel = /^h[2-5]$/.test(headingTag) ? Number(headingTag.slice(1)) : 2;
    if (/^h[2-5]$/.test(tag) && Number(tag.slice(1)) <= headingLevel) break;
    const text = cleanText(sibling.text());
    if (tag === "p" && text) {
      const nextList = sibling.next();
      if (nextList.length && ["ul", "ol"].includes(String(nextList[0].tagName || "").toLowerCase())) {
        const statRows = nextList.children("li").toArray()
          .map((item) => ({ ...parseChangeLine(cleanText($(item).text())), component: text }))
          .filter((detail) => detail.before && detail.after);
        if (statRows.length) {
          currentMonster = text;
          continue;
        }
      }
      if (!hasExplanation && !currentMonster) {
        details.push({ label: null, before: null, after: null, text });
        hasExplanation = true;
      }
    }
    if (tag === "ul" && currentMonster) {
      sibling.children("li").each((_, item) => {
        const line = cleanText($(item).text());
        const parsed = parseChangeLine(line);
        if (parsed.before && parsed.after) details.push({ ...parsed, component: currentMonster });
      });
    }
  }
  return details;
}

function collectJungleMonsterDetails(blades, russian) {
  const jungleHeading = russian ? /^лесные монстры$/i : /^jungle monsters$/i;
  const details = [];
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    let ignoredModeLevel = null;
    for (const heading of $.root().children().first().find("h1,h2,h3,h4,h5,h6,p").toArray()) {
      const tag = String(heading.tagName || "").toLowerCase();
      const text = cleanText($(heading).text());
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        ignoredModeLevel = advanceIgnoredGameModeScope(text, level, ignoredModeLevel);
      }
      if (ignoredModeLevel !== null || !jungleHeading.test(text)) continue;
      details.push(...collectJungleMonsterDetailsFromHeading($, heading));
    }
  }
  return details;
}

function addJungleMonsterDetails(changes, blades, locale) {
  const russian = locale === "ru-ru";
  const details = collectJungleMonsterDetails(blades, russian);
  if (!details.some((detail) => detail.before && detail.after)) return;
  const entityName = russian ? "Лесные монстры" : "Jungle Monsters";
  const row = changes.find((change) => change.entityKind === "system"
    && (/^(?:jungle monsters|лесные монстры)$/i.test(change.entityName || "")
      || (change.details || []).some((detail) => details.some((candidate) => normalizeEntityName(candidate.text) === normalizeEntityName(detail.text)))));
  if (row) {
    row.entityName = entityName;
    row.sectionName = russian ? "Прочие изменения поля боя" : "Other Battlefield Content";
    row.details = details;
    return;
  }
  changes.push({
    entityKind: "system",
    sectionName: russian ? "Прочие изменения поля боя" : "Other Battlefield Content",
    entityName,
    changeName: null,
    details,
  });
}

function collectItemHeadingDetails($, heading, catalog) {
  const details = [];
  let component = null;
  const headingLevel = Number(String(heading.tagName || "").slice(1));
  const headingText = cleanText($(heading).text());
  const headingItem = getCatalogEntity("item", headingText, catalog)
    || findCatalogLead("item", headingText, catalog)?.entity;
  for (let node = heading.next; node; node = node.next) {
    const nodeTag = node.tagName?.toLowerCase();
    if (/^h[2-5]$/.test(nodeTag || "")) {
      const headingDetail = parseNestedItemHeading($, node, headingLevel, catalog);
      if (!headingDetail) break;
      if (headingDetail.component) component = headingDetail.component;
      if (headingDetail.detail) details.push({ ...headingDetail.detail, ...(component ? { component } : {}) });
      continue;
    }
    const contentNodes = ["ul", "ol"].includes(node.tagName?.toLowerCase())
      ? $(node).children("li").toArray()
      : [node];
    if (["ul", "ol"].includes(node.tagName?.toLowerCase())) {
      details.push(...collectItemListDetails($, node, component));
      continue;
    }
    for (const contentNode of contentNodes) {
      const text = cleanText($(contentNode).text());
      if (nodeTag === "p") {
        const paragraphItem = getCatalogEntity("item", text, catalog);
        const sameHeadingItem = headingItem?.slug
          ? paragraphItem?.slug === headingItem.slug
          : normalizeEntityName(headingText) === normalizeEntityName(text);
        if (paragraphItem?.slug && !sameHeadingItem) return details;
      }
      if (nodeTag === "p" && isRichTextItemStatParagraph(node, text, $)) {
        const paragraphItem = getCatalogEntity("item", text, catalog)
          || findCatalogLead("item", text, catalog)?.entity;
        if (paragraphItem?.slug) {
          const sameItem = headingItem?.slug
            ? headingItem.slug === paragraphItem.slug
            : normalizeEntityName(headingText) === normalizeEntityName(text);
          if (!sameItem) return details;
        }
        continue;
      }
      if (isItemComponentHeading(text)) component = text.replace(/:$/, "");
      else if (/^annul:?$/i.test(text) || /^отвод:?$/i.test(text)) component = text.replace(/:$/, "");
      else if (text) details.push({ ...parseChangeLine(text), ...(component ? { component } : {}) });
    }
  }
  return details;
}

function parseNestedItemHeading($, node, parentLevel, catalog) {
  const tag = String(node.tagName || "").toLowerCase();
  if (Number(tag.slice(1)) <= parentLevel || getCatalogEntity("item", cleanText($(node).text()), catalog)?.slug) return null;
  const text = cleanText($(node).text()).replace(/:\s*$/, "");
  if (isItemComponentHeading(text)) return { component: text };
  return /(?:→|->)/.test(text) ? { detail: parseChangeLine(text) } : null;
}

function isItemAdjustmentBlade(blade, $) {
  const fragmentId = cleanText(blade?.fragmentId || "");
  if (/items?.*(?:adjust|change|update)|(?:изменени|корректировк|правк).{0,30}предмет/i.test(fragmentId)) return true;
  return $.root().children().first().find("h2,h3,h4,h5").toArray()
    .some((node) => getCategoryHeading(cleanText($(node).text())) === "item");
}

function inferItemAdjustmentKind(details) {
  const text = details.map((detail) => detail.text || "").join(" ");
  if (/(?:folded|combined|merged|объединили|объединен|перенесли эффект|переработан)/i.test(text)) return "rework";
  const changes = details.filter((detail) => detail.before && detail.after);
  if (!changes.length) return "adjustment";
  const positiveStrengthLabels = /(?:damage|power|health|armor|resist|range|distance|attack speed|critical|crit|shield|heal|healing|penetration|haste|stack|charge|energized|gold gained|gold generated|gold per|slow(?:down)? time|duration|урон|сил(?:а|ы|е|у|ой)?|здоров|брон|сопротив|дальность|расстояни|скорость атаки|крит|щит|лечени|пробивани|ускорени|заряженн|заряд|стак|золота получ|золота генер|продолжительност|длительност)/i;
  const hasPositiveStrengthStat = changes.some(({ label, text }) => positiveStrengthLabels.test(`${label || ""} ${text || ""}`));
  const lowerIsBetterLabels = /(?:price|cost|стоимост|цен)/i;
  const cooldownLabels = /(?:cooldown|cool down|recharge|перезаряд)/i;
  const lowerIsWorseLabels = /(?:threshold|порог)/i;
  const directions = changes.map(({ before, after, label, text: detailText }) => {
    const semanticLabel = `${label || ""} ${detailText || ""}`;
    const direction = compareNumericChangeDirection(before, after);
    const thresholdChange = classifyThresholdChange(semanticLabel, direction);
    if (thresholdChange) return thresholdChange;
    const isPositiveStrength = positiveStrengthLabels.test(semanticLabel);
    const lowerIsBetter = lowerIsBetterLabels.test(semanticLabel)
      || (hasPositiveStrengthStat && cooldownLabels.test(semanticLabel));
    const lowerIsWorse = lowerIsWorseLabels.test(semanticLabel);
    if (!isPositiveStrength && !lowerIsBetter && !lowerIsWorse) return null;

    if (direction === "mixed") return "adjustment";
    if (direction === "incomparable" || direction === "unchanged") return null;
    if (lowerIsBetter || lowerIsWorse) return direction === "decrease" ? "buff" : "nerf";
    return direction === "increase" ? "buff" : "nerf";
  });
  if (directions.some((direction) => direction === "adjustment")) return "adjustment";
  if (directions.some((direction) => direction === null)) return "adjustment";
  if (directions.length && directions.every((direction) => direction === "nerf")) return "nerf";
  if (directions.length && directions.every((direction) => direction === "buff")) return "buff";
  return "adjustment";
}

function createItemAdjustmentContext(blade, locale) {
  const fragmentId = cleanText(blade.fragmentId || "");
  const hasItemFragment = /items?.*(?:adjust|change|update)|(?:изменени|корректировк|правк).{0,30}предмет/i.test(fragmentId);
  return {
    itemSectionLevel: hasItemFragment ? 0 : null,
    itemEntityLevel: null,
    listComponent: null,
    ignoredModeLevel: null,
    sectionName: fragmentId || (locale === "ru-ru" ? "Изменения предметов" : "Item Adjustments"),
  };
}

function updateItemAdjustmentContext(context, text, level, catalog) {
  if (context.ignoredModeLevel === level && getCategoryHeading(text) === "item") return false;
  context.ignoredModeLevel = advanceIgnoredGameModeScope(text, level, context.ignoredModeLevel);
  if (context.ignoredModeLevel !== null) {
    context.itemSectionLevel = null;
    return false;
  }
  const categoryKind = getCategoryHeading(text)
    || (getArticleChangeKind(text) === "system" && !getCatalogEntity("item", text, catalog) ? "system" : null);
  if (categoryKind) {
    context.itemSectionLevel = categoryKind === "item" ? level : null;
    if (categoryKind === "item") context.sectionName = text;
    return false;
  }
  if (context.itemSectionLevel !== null && level < context.itemSectionLevel) context.itemSectionLevel = null;
  return context.itemSectionLevel !== null && level >= context.itemSectionLevel;
}

function getItemAdjustmentCandidate($, heading, catalog, locale, sectionName) {
  const text = cleanText($(heading).text());
  const mentionedItems = findCatalogItemsInText(text, catalog);
  const distinctMentionedItems = new Set(mentionedItems.map(({ entity, alias }) => entity.slug || normalizeEntityName(alias)));
  if (distinctMentionedItems.size > 1 && !/(?:→|->)/.test(text)) return null;
  const item = getCatalogEntity("item", text, catalog) || findRichTextItemMention(text, catalog)?.entity;
  const details = collectItemHeadingDetails($, heading, catalog).filter((detail) => detail.text);
  if (/(?:\/|&|\band\b|\sи\s)/iu.test(text)
    && !details.some((detail) => detail.before && detail.after)) return null;
  if (!details.length || (!item?.slug && (isItemComponentHeading(text) || !details.some((detail) => detail.before && detail.after)))) return null;
  return {
    entityKind: "item",
    entityName: item?.slug ? getCatalogArticleName(text, "item", catalog, item.name || text, locale) : stripEntityMarker(text),
    ...(item?.slug ? { entitySlug: item.slug } : {}),
    changeName: inferItemAdjustmentKind(details),
    sectionName,
    details,
  };
}

function getItemAdjustmentCandidates($, heading, catalog, locale, sectionName) {
  const text = cleanText($(heading).text());
  const mentions = findCatalogItemsInText(text, catalog);
  const distinctItems = new Map(mentions
    .filter(({ entity }) => entity?.slug)
    .map(({ alias, entity }) => [entity.slug, { alias, entity }]));
  if (distinctItems.size <= 1 || !/(?:\/|&|\band\b|\sи\s)/iu.test(text) || /(?:→|->)/.test(text)) {
    const candidate = getItemAdjustmentCandidate($, heading, catalog, locale, sectionName);
    return candidate ? [candidate] : [];
  }
  const details = collectItemHeadingDetails($, heading, catalog)
    .filter((detail) => detail.before && detail.after);
  if (!details.some((detail) => detail.before && detail.after)) return [];
  return Array.from(distinctItems.values(), ({ alias, entity }) => ({
    entityKind: "item",
    entityName: getCatalogArticleName(alias, "item", catalog, entity.name || alias, locale),
    entitySlug: entity.slug,
    changeName: inferItemAdjustmentKind(details),
    sectionName,
    details,
  }));
}

function mergeItemAdjustmentCandidate(changes, candidate) {
  const candidateModes = candidate.scope?.modeSlugs || [];
  const existing = changes.find((change) => change.entityKind === "item"
    && JSON.stringify(change.scope?.modeSlugs || []) === JSON.stringify(candidateModes)
    && ((candidate.entitySlug && change.entitySlug === candidate.entitySlug)
      || normalizeEntityName(change.entityName) === normalizeEntityName(candidate.entityName)));
  if (!existing) {
    changes.push(candidate);
    return;
  }
  if (!existing.entitySlug && candidate.entitySlug) existing.entitySlug = candidate.entitySlug;
  if (!existing.entityName && candidate.entityName) existing.entityName = candidate.entityName;
  for (const detail of candidate.details) {
    if (!existing.details.some((row) => normalizeEntityName(row.text) === normalizeEntityName(detail.text))) existing.details.push(detail);
  }
  const changedCandidateDetails = candidate.details.filter((detail) => detail.before && detail.after);
  const changedExistingDetails = existing.details.filter((detail) => detail.before && detail.after);
  const candidateConfirmsExistingDetails = changedCandidateDetails.length > 0
    && changedCandidateDetails.length === changedExistingDetails.length
    && changedCandidateDetails.every((candidateDetail) => existing.details.some((existingDetail) => (
      existingDetail.before === candidateDetail.before
      && existingDetail.after === candidateDetail.after
      && normalizeEntityName(existingDetail.text) === normalizeEntityName(candidateDetail.text)
    )));
  if (!existing.changeName || (existing.changeName === "adjustment"
    && candidate.changeName !== "adjustment" && candidateConfirmsExistingDetails)) {
    existing.changeName = candidate.changeName;
  }
}

function addCatalogItemRowsFromAdjustments(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    if (!isItemAdjustmentBlade(blade, $)) continue;
    const context = createItemAdjustmentContext(blade, locale);
    const headings = $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray();
    for (const heading of headings) {
      const text = cleanText($(heading).text());
      const level = Number(String(heading.tagName || "").slice(1));
      if (context.itemEntityLevel !== null && level <= context.itemEntityLevel) context.itemEntityLevel = null;
      if (!updateItemAdjustmentContext(context, text, level, catalog)) continue;
      if (context.itemEntityLevel !== null && level > context.itemEntityLevel
        && !getCatalogEntity("item", text, catalog)?.slug) continue;
      const candidates = getItemAdjustmentCandidates($, heading, catalog, locale, context.sectionName);
      if (candidates.length) {
        for (const candidate of candidates) mergeItemAdjustmentCandidate(changes, candidate);
        context.itemEntityLevel = level;
      }
    }
  }
}

function getItemAdjustmentListTargets($, node, text, catalog, sectionName, locale) {
  const buildPathTargets = getItemBuildPathTargets(text, catalog);
  if (buildPathTargets) return buildPathTargets;

  const directMatches = findCatalogItemsInText(text, catalog)
    .filter(({ entity }) => entity?.slug)
    .map((match) => ({ ...match, sourceText: text }));
  if (directMatches.length) return directMatches;

  const nestedMatches = $(node).find("li").toArray()
    .flatMap((nested) => {
      const sourceText = directListItemText(nested, $);
      return findCatalogItemsInText(sourceText, catalog)
        .filter(({ entity }) => entity?.slug)
        .map((match) => ({ ...match, sourceText }));
    });
  const unique = new Map(nestedMatches.map((match) => [match.entity.slug, match]));
  if (unique.size) return [...unique.values()];

  const heading = normalizeEntityName(sectionName);
  const label = normalizeEntityName(text.split(/[:：]/u, 1)[0].replace(/[.]\s*$/u, ""));
  const isBootCost = /^(?:boots?|ботинки|ботинок|сапоги|сапог)$/u.test(heading)
    && (/^(?:boots? (?:cost|price)|(?:cost|price) of boots?)$/u.test(label)
    || /^(?:(?:стоимост|цен)[\p{L}]* (?:ботинок|сапог)[\p{L}]*|(?:ботинок|сапог)[\p{L}]* (?:стоимост|цен)[\p{L}]*)$/u.test(label));
  if (!isBootCost) return [];

  const baseBoots = [...(catalog?.items?.values() || [])].find((entity) => entity?.slug === "boots-of-speed");
  if (!baseBoots) return [];
  return [{ alias: locale === "ru-ru" ? "Ботинки" : baseBoots.name, entity: baseBoots, sourceText: text }];
}

function addCatalogItemRowsFromListAdjustments(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    if (!isItemAdjustmentBlade(blade, $)) continue;
    const context = createItemAdjustmentContext(blade, locale);
    context.removedCategoryLevel = null;
    const blocks = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray()
      .filter((node) => !(String(node.tagName || "").toLowerCase() === "p" && $(node).parents("li").length));
    for (const node of blocks) {
      const tag = String(node.tagName || "").toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const text = cleanText($(node).text());
        const level = Number(tag.slice(1));
        if (context.removedCategoryLevel !== null && level <= context.removedCategoryLevel) {
          context.removedCategoryLevel = null;
        }
        const inItemSection = updateItemAdjustmentContext(context, text, level, catalog);
        if (inItemSection && /^(?:removed|deleted|удален[а-яё]*|удалён[а-яё]*)$/iu.test(text)) {
          context.removedCategoryLevel = level;
          context.listComponent = null;
          context.itemEntityLevel = null;
          continue;
        }
        if (!inItemSection || getCatalogEntity("item", text, catalog)?.slug) context.listComponent = null;
        else if (isItemComponentHeading(text)) context.listComponent = cleanText(text).replace(/:\s*$/, "");
        continue;
      }
      if (tag === "p") {
        const text = cleanText($(node).text());
        if (isItemComponentHeading(text)) context.listComponent = text.replace(/:\s*$/, "");
        else if (getCatalogEntity("item", text, catalog)?.slug) context.listComponent = null;
        continue;
      }
      if (context.itemSectionLevel === null) continue;

      if (context.removedCategoryLevel !== null && tag === "li"
        && $(node).children("ul,ol").length === 0) {
        const name = directListItemText(node, $).replace(/[.;:]+$/u, "").trim();
        const item = getCatalogEntity("item", name, catalog);
        if (item?.slug) {
          mergeItemAdjustmentCandidate(changes, {
            entityKind: "item",
            entityName: getCatalogArticleName(name, "item", catalog, item.name || name, locale),
            entitySlug: item.slug,
            changeName: "removed",
            sectionName: context.sectionName,
            details: [{ label: null, before: null, after: null, text: locale === "ru-ru" ? "Удален из игры." : "Removed from the game." }],
          });
        }
        continue;
      }

      const text = directListItemText(node, $);
      const nestedComponents = nestedItemListComponents(node, $);
      if (isItemBuildPathComponent(context.listComponent)
        || nestedComponents.some(isItemBuildPathComponent)
        || isItemBuildPathComponent(text)) continue;
      const details = parseRichTextDetail(text).filter((detail) => detail.before && detail.after);
      if (!details.length) continue;

      const targets = getItemAdjustmentListTargets($, node, text, catalog, context.sectionName, locale);
      for (const { alias, entity, sourceText } of targets) {
        mergeItemAdjustmentCandidate(changes, {
          entityKind: "item",
          entityName: alias === "Ботинки"
            ? alias
            : getCatalogSourceAlias(sourceText, alias)
              || getCatalogArticleName(alias, "item", catalog, entity.name || alias, locale),
          entitySlug: entity.slug,
          changeName: inferItemAdjustmentKind(details),
          sectionName: context.sectionName,
          details,
        });
      }
    }
  }
}

function collectItemParagraphDetails($, paragraph, item, catalog) {
  const details = [];
  let component = null;
  for (let node = paragraph.next; node; node = node.next) {
    const tag = String(node.tagName || "").toLowerCase();
    const text = cleanText($(node).text());
    if (/^h[1-3]$/.test(tag)) break;
    if (/^h[4-6]$/.test(tag)) {
      const nextItem = getCatalogEntity("item", text, catalog);
      if (nextItem?.slug && nextItem.slug !== item.slug) break;
      if (getCategoryHeading(text)) break;
      if (isItemComponentHeading(text)) {
        component = text.replace(/:$/, "");
        continue;
      }
      if (text) component = text.replace(/:$/, "");
      continue;
    }
    if (tag === "p") {
      const nextItem = getCatalogEntity("item", text, catalog);
      if (nextItem?.slug && nextItem.slug !== item.slug) break;
      if (/^(?:base stats|основные показатели|основные параметры|notes|примечания):?$/i.test(text)
        || isItemComponentHeading(text)) {
        component = text.replace(/:$/, "");
        continue;
      }
      if (text) details.push(...parseRichTextDetail(text).map((detail) => (
        component ? { ...detail, component } : detail
      )));
      continue;
    }
    if (["ul", "ol"].includes(tag)) {
      details.push(...collectItemListDetails($, node, component));
    }
  }
  return details;
}

function collectItemListDetails($, list, inheritedComponent = null) {
  const details = [];
  for (const item of $(list).children("li").toArray()) {
    const text = directListItemText(item, $);
    const nestedLists = $(item).children("ul,ol").toArray();
    const isComponent = nestedLists.length > 0 && isItemListComponentHeading(text);
    const component = isComponent
      ? [inheritedComponent, text.replace(/:\s*$/, "")].filter(Boolean).join(" — ")
      : inheritedComponent;
    if (text && !isComponent) {
      details.push(...parseRichTextDetail(text).map((detail) => (
        component ? { ...detail, component } : detail
      )));
    }
    for (const nestedList of nestedLists) details.push(...collectItemListDetails($, nestedList, component));
  }
  return details;
}

function getUnscopedItemParagraphCandidate($, node, catalog, locale) {
  const text = cleanText($(node).text());
  const item = getCatalogEntity("item", text, catalog);
  if (!item?.slug) return null;
  const tag = String(node.tagName || "").toLowerCase();
  const details = tag === "p"
    ? collectItemParagraphDetails($, node, item, catalog)
    : collectItemHeadingDetails($, node, catalog);
  if (!details.some((detail) => detail.before && detail.after)) return null;
  return {
    entityKind: "item",
    entityName: getCatalogArticleName(text, "item", catalog, item.name || text, locale),
    entitySlug: item.slug,
    changeName: inferItemAdjustmentKind(details),
    sectionName: locale === "ru-ru" ? "Предметы" : "Items",
    details,
  };
}

function addCatalogItemRowsFromStandaloneRichText(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    if (!/^(?:articleRichText|patchNotesRichText)$/.test(blade?.type || "")) continue;
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const root = $.root().children().first();
    const hasItemCategory = root.find("h1,h2,h3,h4,h5").toArray()
      .some((node) => getCategoryHeading(cleanText($(node).text())) === "item");
    if (hasItemCategory) continue;
    for (const node of root.children().toArray()) {
      const tag = String(node.tagName || "").toLowerCase();
      if (!/^h[4-6]$/.test(tag) && tag !== "p") continue;
      const candidate = getUnscopedItemParagraphCandidate($, node, catalog, locale);
      if (candidate) mergeItemAdjustmentCandidate(changes, candidate);
    }
  }
}

function collectHeadingChangeDetails($, heading) {
  const texts = [];
  const headingLevel = Number(String(heading.tagName || "").slice(1));
  let component = null;
  for (let sibling = $(heading).next(); sibling.length; sibling = sibling.next()) {
    const tag = String(sibling[0].tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      if (Number(tag.slice(1)) <= headingLevel) break;
      component = cleanText(sibling.text());
      continue;
    }
    const contentNodes = ["ul", "ol"].includes(tag) ? sibling.children("li").toArray() : [sibling[0]];
    for (const node of contentNodes) {
      if (!["p", "li"].includes(String(node.tagName || "").toLowerCase())) continue;
      const text = nodeTextWithBreaks($, node);
      if (text) texts.push({ text, component });
    }
  }
  return texts.flatMap(({ text, component: detailComponent }) => parseRichTextDetail(text)
    .filter(({ before, after }) => before && after)
    .map((detail) => ({ ...detail, ...(detailComponent ? { component: detailComponent } : {}) })));
}

function hasChampionBaseStatsMarker($, heading) {
  const statsMarker = /^(?:base stats|champion stats|основные показатели|основные характеристики|базовые характеристики)$/i;
  const headingLevel = Number(String(heading.tagName || "").slice(1));
  for (let sibling = $(heading).next(); sibling.length; sibling = sibling.next()) {
    const tag = String(sibling[0].tagName || "").toLowerCase();
    if (/^h[2-5]$/.test(tag) && Number(tag.slice(1)) <= headingLevel) break;
    const nodes = sibling.find("p,h2,h3,h4,h5").addBack("p,h2,h3,h4,h5").toArray();
    if (nodes.some((node) => statsMarker.test(cleanText($(node).text())))) return true;
  }
  return false;
}

function isChampionAdjustmentBlade(blade) {
  return /champions?.*(?:change|adjust|stat|update)|(?:изменени|корректировк|правк).{0,30}чемпион/i
    .test(cleanText(blade?.fragmentId || ""));
}

function mergeChampionStatCandidate(changes, candidate) {
  const existing = changes.find((change) => change.entityKind === "champion"
    && ((candidate.entitySlug && change.entitySlug === candidate.entitySlug)
      || normalizeEntityName(change.entityName) === normalizeEntityName(candidate.entityName)));
  if (!existing) {
    changes.push(candidate);
    return;
  }
  if (!existing.entitySlug && candidate.entitySlug) existing.entitySlug = candidate.entitySlug;
  if (!existing.changeName && candidate.changeName) existing.changeName = candidate.changeName;
  for (const detail of candidate.details) {
    if (!existing.details.some((row) => normalizeEntityName(row.text) === normalizeEntityName(detail.text))) existing.details.push(detail);
  }
}

function parseInlineChampionDetails(rawText) {
  const text = cleanText(rawText);
  const ability = text.match(/^(\([^)]{1,12}\)\s*[^–—-]{1,100}?)\s+[–—-]\s+(.+)$/);
  const details = parseRichTextDetail(ability?.[2] || text)
    .filter(({ before, after }) => before && after);
  return details.map((detail) => ({
    ...detail,
    ...(ability ? { component: cleanText(ability[1]) } : {}),
  }));
}

function isStructuralChampionHeading(blocks, index, $, catalog, currentEntityHeadingLevel) {
  const heading = blocks[index];
  const level = Number(String(heading.tagName || "").slice(1));
  const text = patchArticleNodeText(heading, $);
  if (currentEntityHeadingLevel !== null && level > currentEntityHeadingLevel) return false;
  if (isChampionBaseStatsHeading(text) || /(?:→|->|[:：])/.test(text)) return false;
  return hasInlineChampionChangeAhead(blocks, index, level, catalog, $);
}

function hasInlineChampionChangeAhead(blocks, startIndex, headingLevel, catalog, $) {
  for (let index = startIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    const tag = String(block.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      if (level <= headingLevel) return false;
      const title = cleanText($(block).text());
      if (findCatalogChampionHeading(title, catalog)) return false;
    }
    const text = patchArticleNodeText(block, $);
    if (/(?:→|->)/.test(text) && parseInlineChampionDetails(text).length) return true;
  }
  return false;
}

function addInlineChampionRows(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const blocks = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray();
    let sectionName = cleanText(blade.fragmentId || "");
    let currentChampion = null;
    let currentChampionName = null;
    let currentChampionHeadingLevel = null;
    let currentComponent = null;
    let modeSectionLevel = null;
    let modeSectionHeading = "GAME MODE CHANGES";
    let modeScope = null;
    const fragmentHeading = cleanText(blade.fragmentId || "").replace(/[-_]+/g, " ");
    let activeChangeKind = getArticleHeadingCategoryKind(fragmentHeading) || getArticleChangeKind(fragmentHeading);

    for (const [blockIndex, block] of blocks.entries()) {
      const tag = String(block.tagName || "").toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag.slice(1));
        const title = cleanText($(block).text());
        // A sibling heading ends the previous champion even when its name is
        // absent from the catalog. Nested ability headings stay in that block.
        if (currentChampion && currentChampionHeadingLevel !== null && level <= currentChampionHeadingLevel) {
          currentChampion = null;
          currentChampionName = null;
          currentChampionHeadingLevel = null;
          currentComponent = null;
        }
        if (isChampionRotationHeading(title)) {
          activeChangeKind = null;
          currentChampion = null;
          currentChampionName = null;
          currentComponent = null;
          sectionName = title;
          continue;
        }
        if (isGameModeChangesHeading(title)) {
          modeSectionLevel = level;
          modeSectionHeading = title;
          modeScope = null;
          activeChangeKind = "system";
          currentChampion = null;
          currentChampionName = null;
          currentComponent = null;
          sectionName = title;
          continue;
        }
        if (modeSectionLevel === null && getGameModeScope(title)) {
          modeSectionLevel = level;
          modeSectionHeading = title;
          modeScope = getGameModeScope(title);
          activeChangeKind = "system";
          currentChampion = null;
          currentChampionName = null;
          currentComponent = null;
          sectionName = title;
          continue;
        }
        if (modeSectionLevel !== null) {
          if (level <= modeSectionLevel && !getModeChangeCategory(title)) {
            modeSectionLevel = null;
            modeScope = null;
          } else {
            const recognizedMode = getGameModeScope(title);
            if (recognizedMode) {
              modeScope = recognizedMode;
              currentChampion = null;
              currentChampionName = null;
              currentComponent = null;
              continue;
            }
          }
        }
        if (level <= 2) sectionName = title || sectionName;
        const headingCategory = getArticleHeadingCategoryKind(title);
        if (headingCategory) {
          activeChangeKind = headingCategory;
          currentChampion = null;
          currentChampionName = null;
          currentComponent = null;
          sectionName = title;
          continue;
        }
        const modeCategory = modeSectionLevel !== null ? getModeChangeCategory(title) : null;
        if (modeCategory) activeChangeKind = modeCategory.kind;
        if (activeChangeKind !== "champion" && activeChangeKind !== "system" && level >= 3
          && hasInlineChampionChangeAhead(blocks, blockIndex, level, catalog, $)) {
          activeChangeKind = "champion";
          sectionName ||= locale === "ru-ru" ? "Изменения чемпионов" : "Champion Changes";
        }
        if (activeChangeKind === "champion") {
          const mention = findCatalogChampionHeading(title, catalog);
          const champion = getCatalogEntity("champion", title, catalog) || mention?.entity;
          if (champion?.slug) {
            currentChampion = champion;
            currentChampionName = getLocalizedChampionHeadingName(title, mention, champion, title, locale);
            currentChampionHeadingLevel = level;
            currentComponent = null;
            continue;
          }
        }
        if (currentChampion && /^\([^)]{1,12}\)\s*\S/.test(title)) currentComponent = title;
        continue;
      }
      if (tag === "p" && $(block).parents("li").length) continue;
      const text = patchArticleNodeText(block, $);
      if (!text) continue;

      const inline = text.match(/^(.+?)\s+[–—-]\s+(.+)$/);
      const champion = activeChangeKind === "champion" && inline
        ? getCatalogEntity("champion", inline[1], catalog)
        : null;
      if (champion?.slug) {
        currentChampion = champion;
        currentChampionName = getCatalogArticleName(inline[1], "champion", catalog, champion.name || inline[1], locale);
        currentChampionHeadingLevel = null;
        currentComponent = null;
        const details = parseInlineChampionDetails(inline[2]);
        if (details.length) addInlineChampionCandidate(changes, {
          entityKind: "champion",
          entityName: currentChampionName,
          entitySlug: champion.slug,
          changeName: inferItemAdjustmentKind(details),
          sectionName: inlineChampionSectionName(sectionName, modeScope, modeSectionHeading, locale),
          ...(modeScope ? { scope: modeScope } : {}),
          details,
        });
        continue;
      }

      if (activeChangeKind === "champion" && (tag === "p" || tag === "li")) {
        const headingMention = findCatalogChampionHeading(text, catalog);
        const headingChampion = getCatalogEntity("champion", text, catalog) || headingMention?.entity;
        if (headingChampion?.slug) {
          currentChampion = headingChampion;
          currentChampionName = getLocalizedChampionHeadingName(text, headingMention, headingChampion, text, locale);
          currentChampionHeadingLevel = null;
          currentComponent = null;
          continue;
        }
      }

      if (currentChampion && tag === "p" && /^\([^)]{1,12}\)\s*\S/.test(text) && !/(?:→|->)/.test(text)) {
        currentComponent = text;
        continue;
      }

      if (!currentChampion || !/(?:→|->)/.test(text)) continue;
      const details = parseInlineChampionDetails(text);
      if (!details.length) continue;
      const componentDetails = currentComponent
        ? details.map((detail) => ({ ...detail, component: currentComponent }))
        : details;
      addInlineChampionCandidate(changes, {
        entityKind: "champion",
        entityName: currentChampionName || getCatalogArticleName(currentChampion.name || "", "champion", catalog, currentChampion.name, locale),
        entitySlug: currentChampion.slug,
        changeName: inferItemAdjustmentKind(componentDetails),
        sectionName: inlineChampionSectionName(sectionName, modeScope, modeSectionHeading, locale),
        ...(modeScope ? { scope: modeScope } : {}),
        details: componentDetails,
      });
    }
  }
}

function inlineChampionSectionName(sectionName, modeScope, modeSectionHeading, locale) {
  if (!modeScope) return sectionName || (locale === "ru-ru" ? "Изменения чемпионов" : "Champion Changes");
  const modeName = modeScopeName(modeScope, modeSectionHeading);
  return `${modeName} · ${sectionName || (locale === "ru-ru" ? "Изменения чемпионов" : "Champion Changes")}`;
}

function addInlineChampionCandidate(changes, candidate) {
  if (!candidate.scope) {
    mergeChampionStatCandidate(changes, candidate);
    return;
  }
  const existing = changes.find((change) => change.entityKind === "champion"
    && change.entitySlug === candidate.entitySlug
    && change.scope?.type === candidate.scope.type
    && JSON.stringify(change.scope?.modeSlugs || []) === JSON.stringify(candidate.scope.modeSlugs || []));
  if (!existing) {
    changes.push(candidate);
    return;
  }
  for (const detail of candidate.details) {
    if (!existing.details.some((row) => row.text === detail.text && row.component === detail.component)) existing.details.push(detail);
  }
}

function addCatalogChampionStatRowsFromHeadings(changes, blades, catalog, locale) {
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const fragmentIsChampionSection = isChampionAdjustmentBlade(blade);
    let championSectionLevel = fragmentIsChampionSection ? 0 : null;
    for (const heading of $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray()) {
      const title = cleanText($(heading).text());
      const level = Number(String(heading.tagName || "").slice(1));
      const category = getArticleHeadingCategoryKind(title);
      if (category) {
        championSectionLevel = category === "champion" ? level : null;
        continue;
      }
      if (championSectionLevel !== null && level <= championSectionLevel) championSectionLevel = null;
      if (championSectionLevel === null) continue;
      const champion = getCatalogEntity("champion", title, catalog);
      if (!champion?.slug) continue;
      const details = collectHeadingChangeDetails($, heading);
      if (!details.length || !hasChampionBaseStatsMarker($, heading)) continue;
      mergeChampionStatCandidate(changes, {
        entityKind: "champion",
        entityName: getCatalogArticleName(title, "champion", catalog, champion.name || title, locale),
        entitySlug: champion.slug,
        changeName: inferItemAdjustmentKind(details),
        sectionName: locale === "ru-ru" ? "Изменения характеристик чемпионов" : "Champion Stat Adjustments",
        details,
      });
    }
  }
}

function localizePatchSections(changes, locale) {
  for (const change of changes) {
    if (locale === "ru-ru" && change.entityKind === "champion" && change.sectionName === "Champions") {
      change.sectionName = "ИЗМЕНЕНИЯ ЧЕМПИОНОВ";
    }
  }
}

function hasMeaningfulPatchSections(sections) {
  return sections.some((section) =>
    section.kind === "champion"
    || /<h[2-5]\b/i.test(section.html)
    || (section.heading && !/^introduction$/i.test(section.heading)),
  );
}

export function parsePatchArticle(html, expectedVersion, locale, catalog, { sourceAlias = null } = {}) {
  const page = readNextData(html);
  const { masthead, title, version } = getPatchArticleIdentity(page, expectedVersion, locale, sourceAlias);
  const sections = page.blades.flatMap(parseArticleBlade);
  const hasModeChangesSection = hasGameModeChangesHeading(page.blades);
  const changes = parsePatchChanges(page.blades, catalog, locale).filter((change) => {
    if (change.entityKind !== "system") return true;
    if (change.scope?.type !== "game-mode") {
      change.details = (change.details || []).filter((detail) => !isModeSpecificSystemDetail(detail.text));
    }
    if (!change.details.length) return false;
    const detailsText = change.details.map((detail) => detail.text || detail.after || detail.before || "").join(" ");
    return !(/\p{Extended_Pictographic}/u.test(detailsText) && !/[\p{L}\p{N}]/u.test(detailsText))
      || change.scope?.type === "game-mode"
      || isEmojiOnlyMinionRow(change, locale);
  });
  for (const change of newChampionMentionRows(page.blades, catalog, locale)) {
    if (!changes.some((existing) => existing.entityKind === "champion" && existing.entitySlug === change.entitySlug)) {
      changes.push(change);
    }
  }
  addCatalogChampionStatRowsFromHeadings(changes, page.blades, catalog, locale);
  addInlineChampionRows(changes, page.blades, catalog, locale);
  addSystemRowsFromHeadings(changes, page.blades, catalog, locale);
  addSupplementalSystemRowsFromHeadings(changes, page.blades, catalog, locale);
  addCatalogSpellAdjustmentRows(changes, page.blades, catalog, locale);
  addEmojiOnlyMinionChanges(changes, page.blades, locale);
  addJungleMonsterDetails(changes, page.blades, locale);
  addKnownSystemRows(changes, page.blades, locale);
  localizePatchSections(changes, locale);
  addCatalogItemRowsFromAdjustments(changes, page.blades, catalog, locale);
  addCatalogItemRowsFromListAdjustments(changes, page.blades, catalog, locale);
  addCatalogItemRowsFromStandaloneRichText(changes, page.blades, catalog, locale);
  for (let index = 0; index < changes.length; index += 1) {
    changes[index] = normalizePatchChangeEntityClassification(changes[index]);
  }
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (change.entityKind !== "system") continue;
    if (change.scope?.type !== "game-mode") {
      change.details = (change.details || []).filter((detail) => !isModeSpecificSystemDetail(detail.text));
    }
    if (!change.details.length) changes.splice(index, 1);
  }
  if (hasModeChangesSection && !changes.some((change) => change.scope?.type === "game-mode")) {
    throw new Error("Riot article contains game-mode changes but yielded no scoped change records");
  }
  if (!hasMeaningfulPatchSections(sections)) {
    throw new Error("Riot article parsed without a change section (only masthead/introduction found)");
  }
  for (const change of changes) {
    if (change.entityKind !== "system") continue;
    const localizedName = getRussianPatchEntityName(change.entityName, "system", locale,
      change.entitySlug ? { slug: change.entitySlug } : null);
    if (localizedName) change.entityName = localizedName;
  }
  const sourceUrl = page.url ? resolveRiotUrl(page.url, locale) : null;
  return {
    version,
    locale,
    ...getPatchEffectiveDateMetadata(version),
    title,
    publishedAt: masthead?.publishDate || null,
    sourceUrl,
    description: htmlToText(masthead?.description?.body || ""),
    imageUrl: masthead?.banner?.url || null,
    sections,
    changes,
    championStatSnapshots: extractChampionStatSnapshots(page.blades, catalog, locale, version, sourceUrl),
  };
}

/** Fail closed at import time when a full article produces no structured change rows. */
export function assertPatchArticleReadyForImport(parsed) {
  if (!parsed || !Array.isArray(parsed.changes)) {
    throw new TypeError("Parsed Riot article must contain a changes array");
  }
  if (parsed.changes.length === 0) {
    throw new Error("Riot article yielded no change records; refusing to mark an empty parse as complete");
  }

  const sourceDeltaCounts = new Map();
  const sourceNarrativeChangeCounts = new Map();
  const typedChangeKinds = new Set(["champion", "item", "rune", "spell"]);
  for (const section of parsed.sections || []) {
    if (!section?.html) continue;
    const $ = load(`<div>${section.html}</div>`, null, false);
    const sourceKeysInSection = new Set();
    const sourceNarrativeKeysInSection = new Set();
    let sourceEntityKind = getCategoryHeading(section.heading || "") || getArticleChangeKind(section.heading || "");
    let sourceCategoryHeadingLevel = sourceEntityKind ? 0 : null;
    let sourceEntityHeadingSeen = false;
    const nodes = $.root().children().first().find("h1,h2,h3,h4,h5,h6,li,p").toArray();
    for (const node of nodes) {
      const tag = String(node.tagName).toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const heading = patchArticleNodeText(node, $);
        const headingLevel = Number(tag.slice(1));
        const headingKind = getCategoryHeading(heading) || getArticleChangeKind(heading);
        if (headingKind) {
          sourceEntityKind = headingKind;
          sourceCategoryHeadingLevel = headingLevel;
          sourceEntityHeadingSeen = false;
        } else if (sourceCategoryHeadingLevel !== null && headingLevel <= sourceCategoryHeadingLevel) {
          sourceEntityKind = null;
          sourceCategoryHeadingLevel = null;
          sourceEntityHeadingSeen = false;
        } else if (sourceCategoryHeadingLevel !== null && headingLevel > sourceCategoryHeadingLevel) {
          sourceEntityHeadingSeen = true;
        }
        continue;
      }
      if (tag === "p" && $(node).parents("li").length) continue;
      const text = patchArticleNodeText(node, $);
      if (tag === "li" && typedChangeKinds.has(sourceEntityKind)) sourceEntityHeadingSeen = true;
      if (typedChangeKinds.has(sourceEntityKind) && sourceEntityHeadingSeen && hasStandaloneNumericChangeStatement(text)) {
        // Compare at the same granularity as parsed details. Riot prose can
        // contain several separately labelled effects in one sentence, and
        // parseRichTextDetail intentionally turns those into individual rows.
        for (const sourceDetail of parseRichTextDetail(text)) {
          const keys = normalizeChangeEvidenceVariants(sourceDetail.text);
          const key = keys.join("\u0000");
          if (sourceNarrativeKeysInSection.has(key)) continue;
          sourceNarrativeKeysInSection.add(key);
          sourceNarrativeChangeCounts.set(key, { keys, count: (sourceNarrativeChangeCounts.get(key)?.count || 0) + 1 });
        }
      }
      if (!/[+\-−]?\s*\d[\d.,]*\s*%?.{0,40}(?:→|->).{0,40}[+\-−]?\s*\d[\d.,]*\s*%?/u.test(text)) continue;
      const arrowIndex = text.search(/(?:→|->)/u);
      const targetValue = text.slice(arrowIndex).replace(/^(?:→|->)\s*/u, "");
      // Riot also uses arrows to explain timing in prose (for example,
      // "bonus damage ... -> starting at 2:00"). Count a source delta only
      // when its right-hand side begins with a numeric value.
      if (!/^[([{\s]*[+\-−]?\s*\d[\d.,]*/u.test(targetValue)) continue;

      const deltas = parseRichTextDetail(text).filter((detail) => detail.before && detail.after);
      if (!deltas.length) {
        throw new Error(`Riot article contains an unparsed numeric delta: ${text.slice(0, 180)}`);
      }
      for (const delta of deltas) {
        const keys = normalizeChangeEvidenceVariants(delta.text);
        const key = keys.join("\u0000");
        if (sourceKeysInSection.has(key)) continue;
        sourceKeysInSection.add(key);
        sourceDeltaCounts.set(key, { keys, count: (sourceDeltaCounts.get(key)?.count || 0) + 1 });
      }
    }
  }

  const parsedDeltaVariants = [];
  for (const change of parsed.changes) {
    for (const detail of change.details || []) {
      const keys = normalizeChangeEvidenceVariants(detail?.text);
      if (keys.length && keys[0]) parsedDeltaVariants.push(keys);
    }
  }
  const missingDeltas = [];
  const consumedParsedDeltas = new Set();
  for (const { keys, count } of sourceDeltaCounts.values()) {
    for (let index = 0; index < count; index += 1) {
      const matchIndex = parsedDeltaVariants.findIndex((variants, candidateIndex) => (
        !consumedParsedDeltas.has(candidateIndex) && keys.some((key) => variants.includes(key))
      ));
      if (matchIndex >= 0) consumedParsedDeltas.add(matchIndex);
      else missingDeltas.push(keys[0]);
    }
  }
  if (missingDeltas.length) {
    throw new Error(`Riot parser omitted ${missingDeltas.length} numeric source delta(s): ${missingDeltas.slice(0, 3).join(" | ")}`);
  }
  const missingNarrativeChanges = [];
  const consumedNarrativeChanges = new Set();
  for (const { keys, count } of sourceNarrativeChangeCounts.values()) {
    for (let index = 0; index < count; index += 1) {
      const matchIndex = parsedDeltaVariants.findIndex((variants, candidateIndex) => (
        !consumedNarrativeChanges.has(candidateIndex) && keys.some((key) => variants.includes(key))
      ));
      if (matchIndex >= 0) consumedNarrativeChanges.add(matchIndex);
      else missingNarrativeChanges.push(keys[0]);
    }
  }
  if (missingNarrativeChanges.length) {
    throw new Error(`Riot parser omitted ${missingNarrativeChanges.length} numeric prose change(s): ${missingNarrativeChanges.slice(0, 3).join(" | ")}`);
  }
  return parsed;
}

function normalizeChangeEvidenceVariants(value) {
  const normalized = cleanText(value).normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/->/g, "→")
    .replace(/\s*→\s*/g, "→")
    .replace(/\s*:\s*/g, ":")
    .replace(/[.。]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [normalized];
  const championPrefix = normalized.match(/^.{1,100}?\s+[–—-]\s+(.+)$/u);
  if (championPrefix) variants.push(championPrefix[1]);
  const current = variants.at(-1);
  const abilityPrefix = current.match(/^\([^)]{1,12}\)\s*[^–—-]{1,100}?\s+[–—-]\s+(.+)$/u);
  if (abilityPrefix) variants.push(abilityPrefix[1]);
  const label = variants.at(-1).match(/^[^:]{1,140}:\s*(.+)$/u);
  if (label) variants.push(label[1]);
  return [...new Set(variants)];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
