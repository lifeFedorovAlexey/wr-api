import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";
import { getPatchEffectiveDateMetadata } from "./patchEffectiveDates.mjs";

export const PATCH_NOTES_PARSER_VERSION = 100;

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
  const titleMatch = String(title || "").match(/(?:^|[^\p{L}\p{N}])(?:patch(?:\s+notes)?|описание\s+обновления|патч(?:-ноты|а)?)\s*(\d+)\s*[.\- ]\s*(\d+)([a-z])?\b/iu);
  if (titleMatch) return `${titleMatch[1]}.${titleMatch[2]}${titleMatch[3] || ""}`.toLowerCase();

  const pathMatch = String(url).match(/patch-notes-(\d+)-?(\d+)([a-z])?(?:\/|$)/i)
    || String(url).match(/patch-notes-(\d)(\d)([a-z])-(?:\/|$)/i);
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

function extractStatChanges(html) {
  const $ = load(`<div>${String(html || "")}</div>`, null, false);
  return $.root().children().first().find("li").toArray()
    .map((node) => cleanText($(node).text()))
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
  const beforeMatches = Array.from(beforeText.matchAll(/\d[\d.,]*(?:\s*%|\s*s)?/gi));
  const beforeMatch = beforeMatches.at(-1);
  const afterMatch = afterText.match(/\d[\d.,]*(?:\s*%|\s*s)?/i);
  if (!beforeMatch || !afterMatch) return { label: null, before: null, after: null, text };
  return {
    label: cleanText(beforeText.slice(0, beforeMatch.index)),
    before: cleanText(beforeMatch[0]),
    after: cleanText(afterText.slice(afterMatch.index)),
    text,
  };
}

function directListItemText(node, $) {
  const copy = $(node).clone();
  copy.children("ul, ol").remove();
  return cleanText(copy.text());
}

function parseRichTextDetail(rawText) {
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

function getArticleChangeKind(sectionName) {
  const value = cleanText(sectionName).toLowerCase();
  if (/\bskins?\b|скин|облик|образ/.test(value)) return "skin";
  if (/\b(?:summoner )?spells?\b|заклинан|призывающ(?:ие|их) заклинан|\bsmite\b|кар(?:а|ы|е|у)(?![а-яё])/.test(value)) return "spell";
  if (/\bitems?\b|предмет/.test(value)) return "item";
  if (/\bnew champions?\b|\bchampions? (?:added|introduced)\b|нов(?:ый|ые) чемпион/.test(value)) return "champion";
  if (/\bchampions?\b|чемпион/.test(value)) return "champion";
  if (/\bremoved champions?\b|\bdeleted champions?\b|удален\w* чемпион|убран\w* чемпион/.test(value)) return "champion";
  if (/\brunes?\b|рун/.test(value)) return "rune";
  if (/monster|battlefield|jungle|dragon|nexus|turret plating|game mode|gameplay|обитател|лес|дракон|нексус|башенн(?:ые|ых) пластины|пол(?:е|я) боя|игровых? режим|игрового процесса/.test(value)) return "system";
  return null;
}

function isItemComponentHeading(value) {
  const text = cleanText(value).replace(/:\s*$/, "");
  return /^(?:(?:basic|core|base|additional|main) stats|base stats(?:\s+(?:основные|базовые) (?:параметры|показатели|характеристики))?)$|^(?:основные|базовые|дополнительные) (?:параметры|показатели|характеристики)$|^(?:warmog's heart|сердце вармога|active|passive|active ability|passive ability|mana charge|ruined strikes|lifeline|shock|sunder|chase|resilience|lightshield strike|heavy artillery|bring it down|cauterize|defy|valor|fleetingness|artful strikes|block|dissolution|balance|magebane|noxian gait|blessed blade|big bully|purify(?:\s+очищение)?|annul|ever rising moon|stasis|giant slayer|снос|активное|пассивное|активная способность|пассивная способность|резервуар маны|линия жизни|губительные удары|шок|раскол|погоня|устойчивость|блокирование|прижигание|неповиновение|ледяной панцирь|ноксианская поступь|благословенный клинок|большой задира|удар лайтшилда|тяжелая артиллерия|очищение|аннулирование|вечная восходящая луна|восходящая луна|отвод|стазис|убийца великанов)$/i
    .test(text);
}

function getParserFallbackItem(text, catalog) {
  const normalized = normalizeEntityName(stripEntityMarker(text));
  const fallback = [
    { aliases: ["stormsurge", "штормовой прилив"], slug: "stormsurge", name: "Stormsurge" },
    { aliases: ["mikael's blessing", "mikael’s blessing", "благословение микаэля"], slug: "mikaels-blessing", name: "Mikael's Blessing" },
    { aliases: ["immortal treads", "бессмертные шаги"], slug: "immortal-treads", name: "Immortal Treads" },
    { aliases: ["crimson lucidity", "алое просветление"], slug: "crimson-lucidity", name: "Crimson Lucidity" },
    { aliases: ["lord dominik's regards", "lord dominik’s regards", "поклон лорда доминика"], slug: "lord-dominiks-regards", name: "Lord Dominik's Regards" },
    { aliases: ["the collector", "сборщик долгов"], slug: "the-collector", name: "The Collector" },
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

function findCatalogLead(kind, value, catalog) {
  const text = normalizeEntityName(stripEntityMarker(value));
  const map = kind === "item" ? catalog?.items : kind === "rune" ? catalog?.runes : kind === "spell" ? catalog?.spells : null;
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
  const entityChangeHeading = getEntityChangeHeadingKind(text);
  if (entityChangeHeading) return entityChangeHeading;
  if (/^(?:bug fixes|error fixes|исправлен[а-яё]* ошибок|исправлен[а-яё]* багов|проблемы и исправления)$/i.test(text)) return "system";
  if (/^(?:(?:other|additional)\s+)?champions?(?:\s+(?:base\s+)?stats?)?\s+(?:adjustments?|changes?|updates?)$|^(?:дополнительные\s+)?изменени[яе]\s+(?:базовых\s+)?(?:характеристик\s+)?чемпионов$/i.test(text)) return "champion";
  if (/^(?:systems?|system changes|system adjustments|gameplay systems|gameplay changes|other changes|other adjustments|battlefield system adjustments?|battlefield tempo(?: adjustments?)?|jungle changes?|jungle adjustments?|jungle economy adjustments?|other in-game adjustments?|training camp|custom mode|summoner(?:'|’)s rift|lifesteal|другие изменения|прочие изменения|прочие правки|другие правки|системные изменения|игровые системы|изменения игрового процесса|изменения на поле боя|правила улучшения кары|изменения экономики леса|правила лесных монстров|изменения системы поля боя|башни|кристаллическое разрастание|изменения, связанные с башнями|изменения темпа матча|миньоны|аура суперминьона|показатели миньонов|усиления зачистки миньонов|вампиризм|прочие внутриигровые изменения|внутриигровые рекомендации по ключевым предметам)$/i.test(text)) return "system";
  if (/^(?:marksman item adjustments|изменения предметов для стрелков)$/i.test(text)) return "item";
  if (/^(?:active enchantment item changes?|boots adjustments?|mage item updates?|all tier \d+ mage items? adjustments?)$/i.test(text)) return "item";
  if (/^(?:items?\s+(?:removed|deleted)|(?:удаленные|удалённые) предметы)$/i.test(text)) return "item";
  if (/^(?:smite(?:\s+(?:adjustments?|changes?))?|(?:изменения\s+)?кар(?:а|ы)(?:\s+изменения)?|summoner spells?)$/i.test(text)) return "spell";
  if (/^(?:new|removed|deleted)\s+(?:champions?|items?|runes?|spells?)$|^(?:новые|удаленные)\s+(?:чемпионы|предметы|руны|заклинания)$/i.test(text)) {
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
  if (/^(?:smite|кара|flash|вспышка|ignite|поджог|heal|исцеление|barrier|барьер|ghost|призрак|exhaust|изнурение|teleport|телепорт)$/i.test(text)) return "spell";
  if (/^(?:(?:changes? to|изменения) )?(?:smite|кар(?:а|ы|е|у))(?: changes?)?$/i.test(text)) return "spell";
  if (/^(?:изменени(?:е|я) активных зачарований|изменения ботинок|предметы магов|изменения предметов поддержки|прочие предметы)$/i.test(text)) return "item";
  if (/^изменения чемпионов?[-–— ]/i.test(text)) return "champion";
  return null;
}

function stripEntityMarker(value) {
  return cleanText(value)
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
    || (/^(?:returning|повторн[а-яё]*)(?:\s|$)/i.test(text) ? "returning" : null)
    || (/^(?:removed|deleted|items?\s+(?:removed|deleted)|удален[а-яё]*|удалён[а-яё]*)(?:\s|$)/i.test(text) ? "removed" : null)
    || (/^(?:champions?|items?|runes?|spells?|объект[а-яё]*|предмет[а-яё]*|чемпион[а-яё]*|рун[а-яё]*|заклинан[а-яё]*)\s+(?:added|introduced|добавлен[а-яё]*)$/i.test(text) ? "new" : null)
    || (/^(?:champions?|items?|runes?|spells?|объект[а-яё]*|предмет[а-яё]*|чемпион[а-яё]*|рун[а-яё]*|заклинан[а-яё]*)\s+(?:removed|deleted|удален[а-яё]*|удалён[а-яё]*)$/i.test(text) ? "removed" : null);
}

function getCatalogEntity(kind, value, catalog) {
  const name = normalizeEntityName(stripEntityMarker(value));
  const entityMap = {
    champion: catalog?.champions,
    item: catalog?.items,
    rune: catalog?.runes,
    spell: catalog?.spells,
  }[kind];
  return (kind === "item" ? getParserFallbackItem(value, catalog) : null)
    || (kind === "rune" ? PATCH_RUNE_IDENTITIES.find((rune) => rune.aliases.includes(name)) : null)
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
  return match ? { alias: match[0], entity: match[1] } : null;
}

function findCatalogMention(kind, value, catalog) {
  const text = normalizeEntityName(value);
  const map = kind === "item" ? catalog?.items : kind === "rune" ? catalog?.runes : kind === "spell" ? catalog?.spells : null;
  const aliases = Array.from(map?.keys() || [])
    .filter((alias) => alias.length >= (kind === "item" ? 5 : 3))
    .sort((left, right) => right.length - left.length);
  const alias = aliases.find((candidate) => text.includes(candidate));
  return alias ? { alias, entity: map.get(alias) } : null;
}

function getLocalizedCatalogAlias(value, alias) {
  if (!alias || !/[а-яё]/i.test(alias)) return null;
  const pattern = alias.split(" ").map((word) => Array.from(word, (character) => (
    character === "е" ? "[её]" : character === "и" ? "[ий]" : escapeRegex(character)
  )).join("")).join("[^\\p{L}\\p{N}]*");
  const match = String(value || "").match(new RegExp(pattern, "iu"));
  return match ? cleanText(match[0]) : null;
}

function getCatalogArticleName(value, kind, catalog, fallback, locale) {
  const mention = findCatalogLead(kind, value, catalog) || findCatalogMention(kind, value, catalog);
  return getLocalizedCatalogAlias(value, mention?.alias)
    || getRussianPatchEntityName(value, kind, locale, mention?.entity || getCatalogEntity(kind, value, catalog))
    || fallback;
}

const RUSSIAN_PATCH_ENTITY_NAMES = new Map([
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

const PATCH_RUNE_IDENTITIES = [
  { slug: "ice-overlord", aliases: ["ice overlord", "владыка льда"], name: "Ice Overlord" },
  { slug: "glacial-augment", aliases: ["glacial augment", "ледяной нарост", "ледянои нарост"], name: "Glacial Augment" },
  { slug: "cut-down", aliases: ["cut down", "реванш"], name: "Cut Down" },
];

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

const ENGLISH_PATCH_ENTITY_SLUG_NAMES = new Map([
  ["locket-enchant", "Locket of the Iron Solari"],
  ["mercurial-scimitar", "Mercurial Scimitar"],
]);

function getRussianPatchEntityName(value, kind, locale, entity) {
  if (locale !== "ru-ru") return null;
  return RUSSIAN_PATCH_ENTITY_NAMES.get(`${kind}:${normalizeEntityName(stripEntityMarker(value))}`)
    || RUSSIAN_PATCH_ENTITY_SLUG_NAMES.get(entity?.slug)
    || null;
}

function isGameModeHeading(value) {
  return /^(?:aaa\s+aram|aram|арена|своя игра|отвязное безумие|аркадный режим|arena|adventure mode|battlefest(?:\s+(?:season\s*)?s?\d+)?|unbound frenzy|sonic waves(?:\s+season theme)?|training camp|custom mode|приключенческий режим)$/i.test(cleanText(value));
}

function isPostModePatchSectionHeading(value) {
  return /^(?:bug fixes|error fixes|исправлен[а-яё]* ошибок|исправлен[а-яё]* багов|skins?|облики?|образы?)$/i.test(cleanText(value));
}

function advanceIgnoredGameModeScope(title, level, ignoredModeLevel) {
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
    ignoredGameMode: false,
    ignoredGameModeLevel: null,
    current: null,
    currentEntityHeadingLevel: null,
    currentSystemComponent: null,
    currentListComponent: null,
    removedItemSlugs: new Set(),
  };
}

function flushRichTextChange(state) {
  const { current, records } = state;
  if (current?.splitAsEntities && current.details.length) {
    const seen = new Set();
    for (const detail of current.details) {
      const entityName = cleanText(detail.text);
      const key = entityName.toLowerCase().replace(/ё/g, "е");
      if (!entityName || /^см\.?\s+выше\.?$/i.test(entityName) || seen.has(key)) continue;
      seen.add(key);
      records.push({
        entityKind: current.entityKind,
        sectionName: current.sectionName,
        entityName,
        changeName: null,
        details: [{ label: null, before: null, after: null, text: "Предмет удален из игры." }],
      });
    }
  } else if (current?.details.length || current?.changeName === "new" || current?.changeName === "removed") {
    if (!current.details.length) current.details.push({
      label: null,
      before: null,
      after: null,
      text: current.changeName === "new" ? "Новый объект." : "Удален из игры.",
    });
    records.push(current);
  }
  state.current = null;
  state.currentEntityHeadingLevel = null;
}

function startRichTextEntity(state, kind, name, heading, marker = null) {
  flushRichTextChange(state);
  const catalogEntity = getCatalogEntity(kind, name, state.catalog);
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

function handleRichTextTopHeading(state, text, tag) {
  const level = Number(tag.slice(1));
  state.ignoredGameModeLevel = advanceIgnoredGameModeScope(text, level, state.ignoredGameModeLevel);
  flushRichTextChange(state);
  state.sectionName = text;
  const isModeSection = isGameModeHeading(text)
    || /game mode changes|игровых? режим|режим приключени|^adventure mode$/i.test(text);
  if (isModeSection) state.ignoredGameModeLevel = level;
  state.ignoredGameMode = state.ignoredGameModeLevel !== null || isModeSection;
  state.entityKind = state.ignoredGameMode ? null : getCategoryHeading(text) || getArticleChangeKind(text)
    || (isRuneTreeHeading(text) ? "rune" : null);
  state.categoryMarker = getCategoryMarker(text);
  state.categoryHeadingLevel = state.entityKind ? 2 : null;
  state.currentSystemComponent = null;
  state.currentListComponent = null;
}

function handleRichTextCategoryHeading(state, text, tag) {
  const kind = getCategoryHeading(text);
  if (!kind) return false;
  flushRichTextChange(state);
  state.entityKind = kind;
  state.sectionName = text;
  state.categoryMarker = getCategoryMarker(text);
  state.categoryHeadingLevel = Number(tag.slice(1));
  state.currentSystemComponent = null;
  state.currentListComponent = null;
  return true;
}

function handleRichTextItemHeading(state, text) {
  if (state.entityKind === "item" && isItemComponentHeading(text)) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  const marker = getEntityMarker(text) || state.categoryMarker
    || (state.explicitNewItemNames.has(normalizeEntityName(stripEntityMarker(text))) ? "new" : null);
  const itemMention = findRichTextItemMention(text, state.catalog);
  const knownItem = getCatalogEntity("item", text, state.catalog) || itemMention?.entity;
  if (knownItem || marker) {
    startRichTextItemHeading(state, text, marker, itemMention, knownItem);
    return;
  }
  if (/^(?:removed|deleted|удалено|удаленные предметы|items removed|items deleted)$/i.test(text)) {
    flushRichTextChange(state);
    state.categoryMarker = "removed";
    state.current = {
      entityKind: "item", sectionName: state.sectionName, entityName: text, changeName: null,
      details: [], splitAsEntities: true,
    };
    return;
  }
  flushRichTextChange(state);
  state.currentSystemComponent = text.replace(/:\s*$/, "");
}

function findRichTextItemMention(text, catalog) {
  const mention = findCatalogLead("item", text, catalog) || findCatalogMention("item", text, catalog);
  if (mention) return mention;
  const fallback = getParserFallbackItem(text, catalog);
  return fallback ? { entity: fallback, alias: normalizeEntityName(stripEntityMarker(text)) } : null;
}

function startRichTextItemHeading(state, text, marker, mention, item) {
  const entityName = getLocalizedCatalogAlias(text, mention?.alias)
    || getRussianPatchEntityName(text, "item", state.locale, item)
    || item?.name || text;
  startRichTextEntity(state, "item", entityName, state.sectionName, marker);
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

function handleRichTextEntityHeading(state, text) {
  const { entityKind, catalog } = state;
  if (entityKind === "system" && /^(?:smite|кара)$/i.test(stripEntityMarker(text))) {
    const spell = getCatalogEntity("spell", text, catalog) || findCatalogMention("spell", text, catalog)?.entity;
    if (spell) {
      flushRichTextChange(state);
      state.entityKind = "spell";
      startRichTextEntity(state, "spell", getCatalogArticleName(text, "spell", catalog, spell.name || text, state.locale), state.sectionName, getEntityMarker(text) || state.categoryMarker);
      return;
    }
  }
  if (entityKind === "item") {
    handleRichTextItemHeading(state, text);
    return;
  }
  if (entityKind === "spell") {
    const mention = findCatalogMention("spell", text, catalog);
    const marker = getEntityMarker(text) || state.categoryMarker;
    if (mention || marker) {
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
  if (entityKind === "system") startRichTextEntity(state, "system", text, state.sectionName);
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
  const entityName = formatHeadingDisplayName(getLocalizedCatalogAlias(text, mention?.alias) || champion?.name || headingName, state.locale);
  startRichTextEntity(state, "champion", entityName, state.sectionName, marker);
  if (champion?.slug) state.current.entitySlug = champion.slug;
}

function handleRichTextRuneSpellOrSkinHeading(state, text, entityKind) {
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
    state.currentSystemComponent = text;
    return;
  }
  const marker = getEntityMarker(text)
    || (entityKind === "rune" && state.explicitNewRuneNames.has(normalizeEntityName(stripEntityMarker(text))) ? "new" : null)
    || state.categoryMarker;
  const entityName = entityKind === "skin"
    ? stripEntityMarker(text)
    : getCatalogArticleName(text, entityKind, state.catalog, stripEntityMarker(text), state.locale);
  startRichTextEntity(state, entityKind, entityName, state.sectionName, marker);
}

function handleRichTextSubheading(state, text, tag) {
  if (handleRichTextCategoryHeading(state, text, tag)) return;
  if (!state.entityKind) return;
  if (isGameModeHeading(text)) {
    flushRichTextChange(state);
    state.ignoredGameMode = true;
    state.entityKind = null;
    return;
  }
  const headingLevel = Number(tag.slice(1));
  if (state.current && state.categoryHeadingLevel !== null && headingLevel > state.categoryHeadingLevel + 1) {
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
  handleRichTextEntityHeading(state, text);
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
  if (!mention) return;
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

function handleSpecialRichTextItemParagraph(state, text) {
  if (isItemComponentHeading(text)) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
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
  const mention = findCatalogMention("spell", text, state.catalog);
  if (mention) startRichTextEntity(state, "spell", getLocalizedCatalogAlias(text, mention.alias)
    || getRussianPatchEntityName(text, "spell", state.locale, mention.entity)
    || mention.entity.name || mention.alias, state.sectionName, getEntityMarker(text) || state.categoryMarker);
}

function findCatalogItemsInText(text, catalog) {
  const normalizedText = ` ${normalizeEntityName(text)} `;
  const matches = [];
  const seen = new Set();
  const aliases = Array.from(catalog?.items?.keys() || []).sort((left, right) => right.length - left.length);
  for (const alias of aliases) {
    if (alias.length < 4 || !normalizedText.includes(alias)) continue;
    const entity = catalog.items.get(alias);
    const key = entity?.slug || alias;
    if (!entity || seen.has(key)) continue;
    seen.add(key);
    matches.push({ entity, alias });
  }
  return matches;
}

function addRemovedCatalogItems(state, text) {
  if (state.entityKind !== "item" || state.categoryMarker !== "removed") return false;
  const entities = findCatalogItemsInText(text, state.catalog);
  if (!entities.length) return false;
  flushRichTextChange(state);
  for (const { entity, alias } of entities) {
    if (state.removedItemSlugs.has(entity.slug)) continue;
    state.removedItemSlugs.add(entity.slug);
    const entityName = getLocalizedCatalogAlias(text, alias)
      || getRussianPatchEntityName(text, "item", state.locale, entity)
      || entity.name;
    startRichTextEntity(state, "item", entityName, state.sectionName, "removed");
    flushRichTextChange(state);
  }
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
  const components = state.entityKind === 'system' ? nestedListComponents(node, $) : [];
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
  if (addRemovedCatalogItems(state, text)) return;
  ensureRichTextListRecord(state);
  if (!state.current) return;
  const { detailText, component } = getRichTextListDetailParts(state, node, text, $);
  appendRichTextListDetails(state, detailText, component);
}
function addRichTextParagraphDetails(state, text) {
  if (!state.current || !state.entityKind || !/(?:→|->)/.test(text)) return;
  const details = parseRichTextDetail(text).map((detail) => (
    state.currentSystemComponent ? { ...detail, component: state.currentSystemComponent } : detail
  ));
  appendUniqueRichTextDetails(state.current, details);
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

function handleRichTextSystemSpellParagraph(state, text) {
  if (state.entityKind !== "system" || !/^(?:smite|кара)$/i.test(stripEntityMarker(text))) return false;
  const spell = getCatalogEntity("spell", text, state.catalog) || findCatalogMention("spell", text, state.catalog)?.entity;
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
  if (state.entityKind) {
    const handledAsEntity = handleRichTextParagraphEntity(state, text);
    if (handledAsEntity) return;
  }
  if (state.entityKind === "item") handleRichTextItemParagraphDetails(state, text);
  if (state.entityKind === "spell") handleRichTextSpellParagraph(state, text);
  if (state.entityKind === "item" && isItemComponentHeading(text)) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  addRichTextParagraphDetails(state, text);
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

function handleRichTextNode(state, node, text, $, tag) {
  if (handleRichTextHeadingNode(state, text, tag)) return;
  if (state.ignoredGameMode) return;
  if (tag === "p" && state.entityKind === "item" && isItemComponentHeading(text)) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  if (tag === "p" && /(?:ослабим большинство рун|руны стали играть чересчур важную роль|broad nerfs across most runes|runes have become too impactful)/i.test(text)) {
    flushRichTextChange(state);
    state.entityKind = "rune";
    state.sectionName = /runes/i.test(text) && !/рун/i.test(text) ? "Rune Adjustments" : "Изменения рун";
    state.categoryMarker = null;
    state.currentSystemComponent = null;
    state.currentListComponent = null;
    return;
  }
  if (tag === "p") handleRichTextParagraph(state, text);
  if (tag === "li" && state.entityKind) addRichTextListItem(state, node, text, $);
}

function handleRichTextItemStatHeading(state, text, tag) {
  if (!["h4", "h5"].includes(tag) || state.entityKind !== "item" || !state.current || !/(?:→|->)/.test(text)) return false;
  const detailComponent = state.currentSystemComponent;
  const parsedDetails = parseRichTextDetail(text).map((detail) => trimAppendedItemHeading(detail, state.catalog));
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

function handleRichTextHeadingNode(state, text, tag) {
  if (tag === "h1" || tag === "h2") {
    handleRichTextTopHeading(state, text, tag);
    return true;
  }
  if (!["h3", "h4", "h5", "h6"].includes(tag)) return false;
  const level = Number(tag.slice(1));
  state.ignoredGameModeLevel = advanceIgnoredGameModeScope(text, level, state.ignoredGameModeLevel);
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
  if (!state.ignoredGameMode) handleRichTextSubheading(state, text, tag);
  return true;
}

function isStructuralChampionHeading(blocks, index, $, state) {
  const heading = blocks[index];
  const level = Number(String(heading.tagName || "").slice(1));
  const title = cleanText($(heading).text());
  if (state.currentEntityHeadingLevel !== null && level > state.currentEntityHeadingLevel) return false;
  if (/(?:→|->|[:：])/.test(title)
    || /^(?:base stats|champion stats|основные показатели|основные характеристики|базовые характеристики)$/i.test(title)) return false;
  for (const block of blocks.slice(index + 1)) {
    const tag = String(block.tagName || "").toLowerCase();
    const text = cleanText($(block).text());
    if (/^h[1-6]$/.test(tag)
      && (Number(tag.slice(1)) <= level || findCatalogChampionHeading(text, state.catalog))) return false;
    if (parseRichTextDetail(text).some((detail) => detail.before && detail.after)) return true;
  }
  return false;
}

function parseRichTextChanges(blade, catalog, explicitNewItemNames = new Set(), explicitNewRuneNames = new Set(), locale) {
  if (isLoadoutAdjustmentsBlade(blade)) return parseLoadoutAdjustmentChanges(blade, catalog, locale);
  const html = extractRichText(blade);
  const $ = load(`<div>${html}</div>`, null, false);
  const blocks = $.root().children().first().find("h1,h2,h3,h4,h5,h6,p,li").toArray().filter((node) => {
    const tag = String(node.tagName || "").toLowerCase();
    const element = $(node);
    return !(tag === "li" && element.find("li").length)
      && !(tag === "p" && element.parents("li").length);
  });
  const state = createRichTextChangeState("", catalog, explicitNewItemNames, explicitNewRuneNames, locale);
  for (const [index, node] of blocks.entries()) {
    const text = cleanText($(node).text());
    if (!text) continue;
    const tag = String(node.tagName || "").toLowerCase();
    const headingLevel = Number(tag.slice(1));
    // Entity boundaries follow the source hierarchy, including skipped levels;
    // catalog misses must not turn sibling champions into ability headings.
    if (/^h[3-6]$/.test(tag)
      && state.entityKind === "champion" && !state.ignoredGameMode
      && headingLevel > (state.categoryHeadingLevel ?? 0)
      && !getCategoryHeading(text)
      && isStructuralChampionHeading(blocks, index, $, state)) {
      handleRichTextChampionHeading(state, text, true);
      state.currentEntityHeadingLevel = headingLevel;
      continue;
    }
    const previousEntity = state.current;
    handleRichTextNode(state, node, text, $, tag);
    if (/^h[1-6]$/.test(tag) && state.current?.entityKind === "champion" && state.current !== previousEntity) {
      state.currentEntityHeadingLevel = headingLevel;
    }
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
      const detailsHtml = sanitizeRichText(change?.description?.body || change?.descriptionText || "");
      const details = extractStatChanges(detailsHtml);
      if (!details.length) return [];
      return [{
        entityKind: "champion",
        entityName,
        sourceImageUrl: safeRiotImageUrl(character.media?.url),
        sectionName: "Champions",
        changeName: cleanText(change.title || "General"),
        details,
      }];
    });
    return changes;
  });
}

function parseStructuredChanges(blades, catalog, locale) {
  const explicitNewItemNames = collectExplicitNewItemNames(blades, catalog);
  const explicitNewRuneNames = collectExplicitNewRuneNames(blades, catalog);
  return (Array.isArray(blades) ? blades : []).flatMap((blade) => {
    if (blade?.type === "characterChanges") return parseChampionChanges(blade);
    if (blade?.type === "articleRichText" || blade?.type === "patchNotesRichText") {
      return parseRichTextChanges(blade, catalog, explicitNewItemNames, explicitNewRuneNames, locale);
    }
    return [];
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
  if (captureFollowingName) return extractFollowingSkinName(afterChampion) || "";
  return afterChampion.match(/^([^.!?]{0,60}?)(?:releasing|released|will (?:be )?available|arrives?|appears? in (?:the )?game|появится в игре|выйдет в игру|доступен|доступна|\d{1,2}:\d{2})/i)?.[1] || "";
}

const PATCH_SKIN_SLUGS = [
  { champion: 'jax', aliases: ['glorious eminence jax', 'блистательная знаменитость джакс'], slug: 'jax-glorious-eminence-jax' },
  { champion: 'varus', aliases: ['soul fighter varus', 'боевая душа варус'], slug: 'varus-soul-fighter-varus' },
  { champion: 'varus', aliases: ['ascended soul fighter varus', 'вознесшаяся боевая душа варус'], slug: 'varus-ascended-soul-fighter-varus' },
  { champion: 'galio', aliases: ['hexplorer galio', 'защитник хекспедиции галио'], slug: 'galio-hexplorer-galio', nameRu: 'Защитник хекспедиции Галио' },
  { champion: 'graves', aliases: ['supervillain graves', 'суперзлодей грейвз'], slug: 'graves-supervillain-graves' },
  { champion: 'graves', aliases: ['ascended supervillain graves', 'вознесшийся суперзлодей грейвз'], slug: 'graves-ascended-supervillain-graves' },
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
  { champion: 'renekton', aliases: ['blackfrost renekton', 'ренектон черная стужа'], slug: 'renekton-blackfrost-renekton' },
  { champion: 'renekton', aliases: ['blackfrost renekton purple', 'ренектон черная стужа фиолетовыи'], slug: 'renekton-blackfrost-renekton-purple' },
  { champion: 'ornn', aliases: ['choo choo ornn', 'машинист орн'], slug: 'ornn-choo-choo-ornn' },
  { champion: 'urgot', aliases: ['battlecast urgot', 'модифицированныи ургот'], slug: 'urgot-battlecast-urgot' },
  { champion: 'nasus', aliases: ['dream raider nasus', 'похититель снов насус'], slug: 'nasus-dream-raider-nasus' },
  { champion: 'nasus', aliases: ['unleashed dream raider nasus', 'вознесшийся похититель снов насус'], slug: 'nasus-unleashed-dream-raider-nasus' },
  { champion: 'thresh', aliases: ['dream raider thresh', 'похититель снов треш'], slug: 'thresh-dream-raider-thresh' },
  { champion: 'thresh', aliases: ['unleashed dream raider thresh', 'освобожденный похититель снов треш'], slug: 'thresh-unleashed-dream-raider-thresh' },
  { champion: 'amumu', aliases: ['food spirits amumu', 'гурман амуму'], slug: 'amumu-food-spirits-amumu' },
  { champion: 'amumu', aliases: ['ascended food spirits amumu', 'вознесшийся гурман амуму'], slug: 'amumu-ascended-food-spirits-amumu' },
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
  return candidates.find((entry) => entry.aliases.some((alias) => normalizeEntityName(alias) === normalized))
    || candidates.find((entry) => entry.aliases.some((alias) => normalized.startsWith(`${normalizeEntityName(alias)} `)));
}

function getCanonicalSkinName(championSlug, skinName, locale) {
  const record = findCanonicalSkinRecord(championSlug, skinName);
  return (locale === "ru-ru" ? record?.nameRu : record?.nameEn) || skinName;
}

function extractSkinName(text, championAlias, matchedAt = null, captureFollowingName = false) {
  const source = cleanText(text);
  const occurrence = Number.isInteger(matchedAt)
    ? matchedAt
    : source.toLowerCase().lastIndexOf(championAlias.toLowerCase());
  if (occurrence < 0) return null;
  const end = occurrence + championAlias.length;
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
  prefix = prefix.replace(/^.*?(?:где вас будет ждать|вас будет ждать|на этот раз|вас ждут|получите|unlock(?: the)?|you can get|obtain|along with its upgraded version|вместе с его улучшенной версией|в главных ролях|all-new|(?:the )?new (?:season-exclusive |exclusive )?(?:skins?|skin)|new (?:season-exclusive |exclusive )?(?:skins?|skin)|season-exclusive skin|brand-new exclusive grand skin reward[^:]*?obtain|нов(?:ый|ые) (?:эксклюзивный )?(?:облик|образ)|эксклюзивный образ|(?:повторный\s+)?(?:мини-)?пропуск(?:а|у|ом|е|и|ов|ам|ами|ах)?(?:\s+wild rift)?[,]?\s*(?:с\s+)?|образы?(?:\s+(?:мини-)?пропуска)?[^:]*:|доступны новые образы?\s*[–—:-]*|returning skins?[^:]*:|skins?[^:]*:|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+chromas?\s+(?:for|of)|featuring|starring)\s*/i, "");
  const afterChampion = source.slice(end);
  let skinSuffix = extractSkinSuffix(afterChampion, captureFollowingName);
  if (/^\s*(?:will|is|has|have|arrives?|выйдет|появится|будет|станет)\b/i.test(skinSuffix)) skinSuffix = "";
  const candidate = cleanText(`${prefix} ${source.slice(occurrence, end)} ${skinSuffix}`)
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
  const hasCue = /(?:облик|образ(?!\s+жизни)|скин|skin|skins|костюм|цветов[а-яё]*\s+схем[а-яё]*|хроматик|появится в игре|выйдет в игру|станет доступ|available|arrives?|joins? the game|releas(?:e|es|ed|ing)|all-new|в главных ролях|(?:wild pass|mini pass).{0,120}(?:starring|featuring)|(?:пропуск|мини-пропуск).{0,120}(?:в главных ролях|ждет|ждут|на сцену))/i.test(text)
    || isReturningMiniPassSkin(text)
    || /(?:wild pass|mini pass|мини-пропуск|пропуск wild rift)/i.test(text)
    || Boolean(skinListMode);
  return hasCue && (Boolean(skinListMode) || isReturningMiniPassSkin(text)
    || /(?:облик|образ(?!\s+жизни)|скин|skin|skins|цветов[а-яё]*\s+схем[а-яё]*|хроматик|chromas?|появится в игре|выйдет в игру|доступен|доступна|available|arrives?|joins? the game|releas(?:e|es|ed|ing)|в главных ролях|(?:wild pass|mini pass|мини-пропуск|пропуск wild rift))/i.test(text));
}

function getAnnouncementSkinFlags(text, champion, skinListMode) {
  const explicitReturning = /(?:returning\b|returns?\b|return track|возвраща[а-яё]* облик|повторн[а-яё]* (?:облик|образ|наград)|образы возвраща[а-яё]*|образы прошлых лет)/i.test(text)
    || isReturningMiniPassSkin(text);
  const explicitNew = /(?:нов[а-яё]* (?:эксклюзивный )?(?:облик|образ)|эксклюзивн[а-яё]* (?:облик|образ)|new (?:season-exclusive |exclusive )?skins?|new skin|season-exclusive skin|brand-new exclusive grand skin|all-new|(?:wild pass|mini pass) arrives?.{0,100}(?:featuring|starring)|new .{0,60}(?:wild pass|mini pass).{0,100}(?:featuring|starring)|(?:wild pass|mini pass).{0,100}(?:premieres?|takes center stage|featuring|starring)|(?:releas(?:e|es|ed|ing)|joins? the game|available)|(?:пропуск|мини-пропуск).{0,100}(?:выйдет|ждет|будет ждать|появится|на сцену)|нового пропуска|в главных ролях|появится в игре|выйдет в игру|доступен|доступна)/i.test(text);
  const chromaMention = /(?:хроматик|цветов[а-яё]*\s+схем[а-яё]*|chromas?)/i.test(text);
  const returning = explicitReturning || (skinListMode === 'returning' && !explicitNew && !chromaMention);
  const newSkin = !returning && (skinListMode === 'new' || explicitNew);
  const chromaOnly = /(?:хроматик|цветов[а-яё]*\s+схем[а-яё]*|chromas?)/i.test(text) && !returning && !newSkin;
  const legendsChroma = champion.slug === 'volibear' && /(?:legends showdown|гроза легенд)/i.test(text);
  const unnamedChromaSet = chromaOnly && /\b\d+\s+chromas?\b|\bchromas?\b|хроматик|цветов[а-яё]*\s+схем[а-яё]*/i.test(text);
  return { returning, newSkin, chromaOnly, legendsChroma, unnamedChromaSet };
}

function isColorVariant(value) {
  return /\((?:pink|yellow|amber|purple|розов[а-яё]*|желт[а-яё]*|янтарн[а-яё]*|фиолетов[а-яё]*)\)/i.test(value);
}

function isAnnouncementChestSkinMention(text) {
  if (/(?:contains six hidden chromas|содержит шесть тайных цветов[а-яё]*\s+схем)/i.test(text)) return false;
  return /(?:friendship|skin) chest.{0,80}(?:skin drops|includes)|(?:сундук|сокровищниц).{0,80}(?:выпада|содерж[а-яё]*).{0,40}(?:облик|образ)|this season's rewards are all themed around.{0,100}chromas|награды этого сезона посвящены.{0,100}хроматик/i.test(text);
}

function getAnnouncementSkinTitle(entityName, champion, flags) {
  const extractedTitle = cleanSkinTitle(entityName);
  const hasNamedChromaSkin = flags.unnamedChromaSet
    && !/\s+chromas?$/i.test(extractedTitle)
    && !champion.aliases?.some((alias) => normalizeEntityName(extractedTitle) === normalizeEntityName(alias));
  if (flags.legendsChroma) return 'Legends Showdown Volibear chromas';
  if (flags.unnamedChromaSet) return /\s+chromas?$/i.test(extractedTitle)
    ? extractedTitle
    : `${hasNamedChromaSkin ? extractedTitle : champion.name} chromas`;
  return extractedTitle;
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
  const pattern = locale === "ru-ru"
    ? /(?:Появится|Выйдет) в игре\s+\d{1,2}\s+[А-Яа-яЁё]+\s+в\s+\d{1,2}:\d{2}\s+по московскому времени/i
    : /(?:Releasing|Released)\s+[A-Za-z]+\s+\d{1,2}\s*@\s*\d{2}:\d{2}\s+UTC/i;
  return clean.match(pattern)?.[0] || null;
}

function shouldIgnoreAnnouncementSkin(text, alias, match) {
  if (/(?:information|информация).{0,40}(?:incorrect|wrong|неверн|ошибочн)/i.test(text)) return true;
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
  const entityName = extractSkinName(text, alias, match.index, shouldCaptureFollowingSkinName(text, skinListMode));
  if (!entityName) return null;
  const flags = getAnnouncementSkinFlags(text, champion, skinListMode);
  if (flags.chromaOnly && !flags.unnamedChromaSet) return null;
  const skinName = getCanonicalSkinName(champion.slug, getAnnouncementSkinTitle(entityName, champion, flags), locale);
  if (champion.aliases?.some((alias) => normalizeEntityName(skinName) === normalizeEntityName(alias))) return null;
  return {
    entityKind: 'skin',
    entityName: skinName,
    entitySlug: getCanonicalAnnouncementSkinSlug(champion.slug, skinName),
    sourceChampionSlug: champion.slug,
    changeName: flags.returning ? 'returning' : flags.newSkin && !flags.legendsChroma && !flags.unnamedChromaSet && !isColorVariant(skinName) ? 'new' : 'available',
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

function hasSkinReleaseDate(change) {
  return (change.details || []).some((detail) => /(?:releasing|released)\s+[a-z]+\s+\d{1,2}\s*@\s*\d{2}:\d{2}\s+utc|(?:появится|выйдет) в игре\s+\d{1,2}\s+[а-яё]+\s+в\s+\d{1,2}:\d{2}\s+по московскому времени/i.test(detail.text || ''));
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
    } else if (getSkinChangePriority(change.changeName) > getSkinChangePriority(existing.changeName)) {
      Object.assign(existing, change);
    } else if (hasSkinReleaseDate(change) && !hasSkinReleaseDate(existing)) {
      existing.details = change.details;
      existing.sectionName = change.sectionName;
    } else if (!existing.sourceImageUrl && change.sourceImageUrl) {
      existing.sourceImageUrl = change.sourceImageUrl;
    }
  }
  return merged;
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
    const nodes = $.root().children().first().find('h1,h2,h3,h4,h5,h6,p,li').toArray();
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
      const endingBoundary = cyrillicAlias
        ? '(?=$|[^A-Za-z0-9А-Яа-я]|(?:ом|а|у|е|ы|и|ой|ым|ого|ому))'
        : '(?![A-Za-z0-9А-Яа-я])';
      const expression = new RegExp(`(?<![A-Za-z0-9А-Яа-я])${escapeRegex(alias)}${endingBoundary}`, 'ig');
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
  const tableSkin = hasSkinTable && (/(?:releasing|released|появится в игре|выйдет в игру|доступен|доступна)/i.test(text) || shortSkinTitle);
  const passSkin = /(?:wild pass|mini pass).{0,120}(?:arrives?|premieres?|featuring|starring)|(?:arrives?|premieres?).{0,120}(?:wild pass|mini pass).{0,120}(?:featuring|starring)/i.test(text);
  return { tableSkin, passSkin };
}

function makeSkinTableChange(text, matchData, tableSkin, sourceImageUrl, locale) {
  const { champion, alias, match } = matchData;
  if (/(?:has arrived on the rift|arrives on the rift|прибывает в ущелье|прибывает на рифт)/i.test(text)
    && !/(?:skin|облик|образ|скин)/i.test(text)) return null;
  const title = cleanSkinTitle(tableSkin
    ? text.replace(/(?:releasing|released|появится в игре|выйдет в игру|доступен|доступна).*$/i, '')
    : extractSkinName(text, alias, match.index));
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
    .map((_, paragraph) => cleanText($(paragraph).text())).get().join(' ');
  return findAllSkinAliasMatches(caption, champions)
    .map((match) => makeSkinTableChange(caption, match, true, sourceImageUrl, locale))
    .filter(Boolean);
}

function parseSkinTableChanges(blades, catalog, locale) {
  const champions = uniqueChampions(catalog);
  const changes = [];
  let inSkinSection = false;
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
        continue;
      }
      if (tag === 'tr') {
        changes.push(...parseSkinProbabilityRow($, node, champions, locale));
        continue;
      }
      if (tag === 'td' && inSkinSection) {
        changes.push(...parseSkinImageCell($, node, champions, locale));
        continue;
      }
      if (['p', 'li'].includes(tag)) {
        const paragraph = htmlToText($(node).html().replace(/<br\s*\/?\s*>/gi, ' '));
        changes.push(...parseSkinTableParagraph(paragraph, champions, inSkinSection, locale));
      }
    }
  }
  return changes;
}

function parseSkinProbabilityRow($, row, champions, locale) {
  const cells = $(row).children('td,th').toArray();
  if (cells.length < 2) return [];
  const skinName = cleanText($(cells[0]).text());
  const probability = cleanText($(cells[1]).text());
  if (!skinName || /\bchests?\b|сундук|сокровищниц/i.test(skinName) || !/\d+(?:[.,]\d+)?\s*%/.test(probability)) return [];
  return findAllSkinAliasMatches(skinName, champions)
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

function getPatchArticleIdentity(page, expectedVersion) {
  const masthead = page.blades.find((blade) => blade?.type === "articleMasthead");
  const title = cleanText(masthead?.title || page.title);
  const version = extractPatchVersion(title, page.url || "");
  if (!title || !version || version !== expectedVersion) {
    throw new Error(`Riot article version mismatch (expected ${expectedVersion}, found ${version || "none"})`);
  }
  return { masthead, title, version };
}

function parsePatchChanges(blades, catalog, locale) {
  const changes = mergeSkinChangeRows([
    ...parseStructuredChanges(blades, catalog, locale),
    ...parseAnnouncementChanges(blades, catalog, locale),
    ...parseSkinTableChanges(blades, catalog, locale),
  ]).filter((change) => !isGameModeChange(change)
    && !(change.entityKind === "skin" && (String(change.entityName || "").length > 100 || isSkinSectionHeading(change.entityName))));
  const namedSkinFamilies = changes.filter((change) => change.entityKind === 'skin'
    && change.sourceChampionSlug && !/\s+chromas?$/i.test(change.entityName || ""));
  return changes.filter((change) => {
    if (change.entityKind !== 'skin' || !/\s+chromas?$/i.test(change.entityName || "")) return true;
    const familyName = normalizeEntityName(change.entityName).replace(/ chromas?$/, '');
    return !namedSkinFamilies.some((skin) => skin.sourceChampionSlug === change.sourceChampionSlug
      && normalizeEntityName(skin.entityName).startsWith(`${familyName} `));
  });
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

function collectSystemHeadingDetails($, heading) {
  const details = [];
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
      const text = cleanText($(node).text());
      if (text) details.push({ ...parseChangeLine(text), ...(component ? { component } : {}) });
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
  if (locale === "ru-ru") return `${lower[0]?.toLocaleUpperCase(locale) || ""}${lower.slice(1)}`;
  return lower.replace(/\b[a-z]/g, (letter) => letter.toLocaleUpperCase(locale));
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
  };
}

function advanceSystemHeadingContext(context, title, level) {
  context.ignoredModeLevel = advanceIgnoredGameModeScope(title, level, context.ignoredModeLevel);
  if (context.ignoredModeLevel !== null) {
    context.sectionLevel = null;
    return false;
  }
  const category = getCategoryHeading(title);
  if (context.sectionLevel !== null && level <= context.sectionLevel) context.sectionLevel = null;
  if (category) {
    context.sectionLevel = category === "system" ? level : null;
    if (context.sectionLevel !== null) context.sectionName = title;
    return false;
  }
  if (context.sectionLevel !== null) return level > context.sectionLevel;
  return context.fragmentSuggestsSystems;
}

function addSystemRowsFromHeadings(changes, blades, locale) {
  for (const blade of blades || []) {
    const markup = extractRichText(blade);
    if (!markup) continue;
    const $ = load(`<div>${markup}</div>`, null, false);
    const context = createSystemHeadingContext(blade, locale);
    for (const heading of $.root().children().first().find("h1,h2,h3,h4,h5,h6").toArray()) {
      const title = cleanText($(heading).text());
      const level = Number(String(heading.tagName || "").slice(1));
      if (getCategoryHeading(title) === "system") {
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
      const details = collectSystemHeadingDetails($, heading);
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

function collectSystemHeadingOwnDetails($, heading) {
  const details = [];
  for (let sibling = heading.next; sibling; sibling = sibling.next) {
    const tag = String(sibling.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag)) break;
    const nodes = ["ul", "ol"].includes(tag) ? $(sibling).children("li").toArray() : [sibling];
    for (const node of nodes) {
      if (!["p", "li"].includes(String(node.tagName || "").toLowerCase())) continue;
      const text = cleanText($(node).text());
      if (text) details.push(parseChangeLine(text));
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
        mergeCatalogSpellHeading(changes, candidate, collectSystemHeadingDetails($, heading), context.sectionName);
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
    for (const contentNode of contentNodes) {
      const text = cleanText($(contentNode).text());
      if (/^(?:base stats|основные показатели|основные параметры):?$/i.test(text)) component = text.replace(/:$/, "");
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
  const positiveStrengthLabels = /(?:damage|power|health|armor|resist|range|attack speed|critical|crit|shield|heal|healing|penetration|haste|урон|сила|здоров|брон|сопротив|дальность|скорость атаки|крит|щит|лечени|пробивани|ускорени)/i;
  const directions = changes.map(({ before, after, label }) => {
    if (!positiveStrengthLabels.test(label || "")) return null;
    const parseScalar = (value) => {
      const scalar = /^\s*(-?\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(value));
      return scalar ? Number(scalar[1].replace(",", ".")) : null;
    };
    const beforeValue = parseScalar(before);
    const afterValue = parseScalar(after);
    return beforeValue !== null && afterValue !== null ? Math.sign(afterValue - beforeValue) : null;
  });
  if (directions.some((direction) => direction === null || direction === 0)) return "adjustment";
  if (directions.length && directions.every((direction) => direction < 0)) return "nerf";
  if (directions.length && directions.every((direction) => direction > 0)) return "buff";
  return "adjustment";
}

function createItemAdjustmentContext(blade, locale) {
  const fragmentId = cleanText(blade.fragmentId || "");
  const hasItemFragment = /items?.*(?:adjust|change|update)|(?:изменени|корректировк|правк).{0,30}предмет/i.test(fragmentId);
  return {
    itemSectionLevel: hasItemFragment ? 0 : null,
    itemEntityLevel: null,
    ignoredModeLevel: null,
    sectionName: fragmentId || (locale === "ru-ru" ? "Изменения предметов" : "Item Adjustments"),
  };
}

function updateItemAdjustmentContext(context, text, level) {
  context.ignoredModeLevel = advanceIgnoredGameModeScope(text, level, context.ignoredModeLevel);
  if (context.ignoredModeLevel !== null) {
    context.itemSectionLevel = null;
    return false;
  }
  const categoryKind = getCategoryHeading(text);
  if (categoryKind) {
    context.itemSectionLevel = categoryKind === "item" ? level : null;
    if (categoryKind === "item") context.sectionName = text;
    return false;
  }
  if (context.itemSectionLevel !== null && level <= context.itemSectionLevel) context.itemSectionLevel = null;
  return context.itemSectionLevel !== null && level > context.itemSectionLevel;
}

function getItemAdjustmentCandidate($, heading, catalog, locale, sectionName) {
  const text = cleanText($(heading).text());
  const item = getCatalogEntity("item", text, catalog);
  const details = collectItemHeadingDetails($, heading, catalog).filter((detail) => detail.text);
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

function mergeItemAdjustmentCandidate(changes, candidate) {
  const existing = changes.find((change) => change.entityKind === "item"
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
  if (!existing.changeName) existing.changeName = candidate.changeName;
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
      if (!updateItemAdjustmentContext(context, text, level)) continue;
      if (context.itemEntityLevel !== null && level > context.itemEntityLevel
        && !getCatalogEntity("item", text, catalog)?.slug) continue;
      const candidate = getItemAdjustmentCandidate($, heading, catalog, locale, context.sectionName);
      if (candidate) {
        mergeItemAdjustmentCandidate(changes, candidate);
        context.itemEntityLevel = level;
      }
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
      const text = cleanText($(node).text());
      if (text) texts.push({ text, component });
    }
  }
  return texts.map(({ text, component: detailComponent }) => {
    const detail = parseChangeLine(text);
    return detail.before && detail.after
      ? { ...detail, ...(detailComponent ? { component: detailComponent } : {}) }
      : null;
  }).filter(Boolean);
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
      const category = getCategoryHeading(title);
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

function applyEntityNameAliases(changes, locale) {
  for (const change of changes) {
    if (locale === "en-us" && change.entityKind === "item") {
      change.entityName = ENGLISH_PATCH_ENTITY_SLUG_NAMES.get(change.entitySlug) || change.entityName;
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

export function parsePatchArticle(html, expectedVersion, locale, catalog) {
  const page = readNextData(html);
  const { masthead, title, version } = getPatchArticleIdentity(page, expectedVersion);
  const sections = page.blades.flatMap(parseArticleBlade);
  const changes = parsePatchChanges(page.blades, catalog, locale).filter((change) => {
    if (change.entityKind !== "system") return true;
    change.details = (change.details || []).filter((detail) => !isModeSpecificSystemDetail(detail.text));
    if (!change.details.length) return false;
    const detailsText = change.details.map((detail) => detail.text || detail.after || detail.before || "").join(" ");
    return !(/\p{Extended_Pictographic}/u.test(detailsText) && !/[\p{L}\p{N}]/u.test(detailsText))
      || isEmojiOnlyMinionRow(change, locale);
  });
  addCatalogChampionStatRowsFromHeadings(changes, page.blades, catalog, locale);
  addSystemRowsFromHeadings(changes, page.blades, locale);
  addCatalogSpellAdjustmentRows(changes, page.blades, catalog, locale);
  addEmojiOnlyMinionChanges(changes, page.blades, locale);
  addJungleMonsterDetails(changes, page.blades, locale);
  applyEntityNameAliases(changes, locale);
  addKnownSystemRows(changes, page.blades, locale);
  localizePatchSections(changes, locale);
  addCatalogItemRowsFromAdjustments(changes, page.blades, catalog, locale);
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (change.entityKind !== "system") continue;
    change.details = (change.details || []).filter((detail) => !isModeSpecificSystemDetail(detail.text));
    if (!change.details.length) changes.splice(index, 1);
  }
  if (!hasMeaningfulPatchSections(sections)) {
    throw new Error("Riot article parsed without a change section (only masthead/introduction found)");
  }
  return {
    version,
    locale,
    ...getPatchEffectiveDateMetadata(version),
    title,
    publishedAt: masthead?.publishDate || null,
    sourceUrl: page.url ? resolveRiotUrl(page.url, locale) : null,
    description: htmlToText(masthead?.description?.body || ""),
    imageUrl: masthead?.banner?.url || null,
    sections,
    changes,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
