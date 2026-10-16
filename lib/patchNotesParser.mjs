import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";
import { getPatchEffectiveDateMetadata } from "./patchEffectiveDates.mjs";

export const PATCH_NOTES_PARSER_VERSION = 61;

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
  if (!tags.some(isPatchNotesTag)) return null;
  const action = rawAction || {};
  const payload = action.payload || {};
  const url = resolveRiotUrl(payload.url || action.url, locale);
  const title = cleanText(rawTitle);
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
  const unique = new Map();
  for (const item of items) {
    if (!unique.has(item.version)) unique.set(item.version, item);
  }
  if (!unique.size) throw new Error("Riot patch index returned no valid patch-note cards");
  return Array.from(unique.values());
}

function sanitizeRichText(html) {
  return sanitizeHtml(String(html || ""), {
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
  return /^(?:(?:basic|core|base|additional|main) stats|base stats(?:\s+(?:основные|базовые) (?:параметры|показатели|характеристики))?)$|^(?:основные|базовые|дополнительные) (?:параметры|показатели|характеристики)$|^(?:active|passive|active ability|passive ability|mana charge|ruined strikes|lifeline|shock|sunder|chase|resilience|lightshield strike|heavy artillery|cauterize|defy|valor|fleetingness|artful strikes|block|dissolution|balance|magebane|noxian gait|blessed blade|big bully|purify(?:\s+очищение)?|annul|ever rising moon|stasis|giant slayer|снос|активное|пассивное|активная способность|пассивная способность|резервуар маны|линия жизни|губительные удары|шок|раскол|погоня|устойчивость|блокирование|прижигание|неповиновение|ледяной панцирь|ноксианская поступь|благословенный клинок|большой задира|удар лайтшилда|очищение|аннулирование|вечная восходящая луна|восходящая луна|отвод|стазис|убийца великанов)$/i
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

function getCategoryHeading(value) {
  const text = cleanText(value);
  if (/^(?:system changes|system adjustments|gameplay systems|gameplay changes|other changes|other adjustments|battlefield system adjustments?|battlefield tempo adjustments?|jungle adjustments?|jungle economy adjustments?|other in-game adjustments?|training camp|custom mode|summoner(?:'|’)s rift|lifesteal|другие изменения|прочие изменения|прочие правки|другие правки|системные изменения|игровые системы|изменения игрового процесса)$/i.test(text)) return "system";
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
    || (/^(?:new(?:\s|$)|новые(?:\s|$))/i.test(text) ? "new" : null)
    || (/^(?:removed(?:\s|$)|deleted(?:\s|$)|items?\s+(?:removed|deleted)(?:\s|$)|удаленные(?:\s|$)|удалённые(?:\s|$))/i.test(text) ? "removed" : null);
}

function getCatalogEntity(kind, value, catalog) {
  const name = normalizeEntityName(stripEntityMarker(value));
  if (kind === "champion") return catalog?.champions?.get(name) || null;
  if (kind === "item") return getParserFallbackItem(value, catalog) || catalog?.items?.get(name) || null;
  if (kind === "rune") return catalog?.runes?.get(name) || null;
  if (kind === "spell") return catalog?.spells?.get(name) || null;
  return null;
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

const RUSSIAN_PATCH_ENTITY_SLUG_NAMES = new Map([
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

function getRussianPatchEntityName(value, kind, locale, entity) {
  if (locale !== "ru-ru") return null;
  return RUSSIAN_PATCH_ENTITY_NAMES.get(`${kind}:${normalizeEntityName(stripEntityMarker(value))}`)
    || RUSSIAN_PATCH_ENTITY_SLUG_NAMES.get(entity?.slug)
    || null;
}

function isGameModeHeading(value) {
  return /^(?:aaa\s+aram|aram|арена|отвязное безумие|аркадный режим|arena|adventure mode|battlefest(?:\s+s\d+)?|sonic waves(?:\s+season theme)?|training camp|custom mode|summoner(?:'|’)s rift|приключенческий режим)$/i.test(cleanText(value));
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
    ignoredGameMode: false,
    current: null,
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
    ...(kind === "item" ? { entitySlug: catalogEntity?.slug || null } : {}),
    changeName: marker || null,
    details: [],
  };
  if (marker === "removed") state.current.details.push({
    label: null, before: null, after: null, text: "Удален из игры.",
  });
  state.currentSystemComponent = null;
  state.currentListComponent = null;
}

function handleRichTextTopHeading(state, text) {
  flushRichTextChange(state);
  state.sectionName = text;
  state.ignoredGameMode = /game mode changes|игровых? режим|режим приключени|арена|aaa\s*aram|отвязное безумие|^adventure mode$|^battlefest(?:\s+s\d+)?$|^sonic waves(?:\s+season theme)?$/i.test(text);
  state.entityKind = state.ignoredGameMode ? null : getCategoryHeading(text) || getArticleChangeKind(text)
    || (isRuneTreeHeading(text) ? "rune" : null);
  state.categoryMarker = getCategoryMarker(text);
  state.currentSystemComponent = null;
  state.currentListComponent = null;
}

function handleRichTextCategoryHeading(state, text) {
  const kind = getCategoryHeading(text);
  if (!kind) return false;
  flushRichTextChange(state);
  state.entityKind = kind;
  state.sectionName = text;
  state.categoryMarker = getCategoryMarker(text);
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
    if (mention) startRichTextEntity(state, "spell", text, state.sectionName, getEntityMarker(text) || state.categoryMarker);
    else state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  if (entityKind === "champion") {
    const champion = getCatalogEntity("champion", text, catalog);
    if (champion || getEntityMarker(text)) startRichTextEntity(state, "champion", text, state.sectionName, getEntityMarker(text));
    else state.currentSystemComponent = text.replace(/:\s*$/, "");
    return;
  }
  if (["rune", "spell", "skin"].includes(entityKind)) {
    handleRichTextRuneSpellOrSkinHeading(state, text, entityKind);
    return;
  }
  if (entityKind === "system") startRichTextEntity(state, "system", text, state.sectionName);
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

function handleRichTextSubheading(state, text) {
  if (handleRichTextCategoryHeading(state, text)) return;
  if (!state.entityKind) return;
  if (isGameModeHeading(text)) {
    flushRichTextChange(state);
    state.ignoredGameMode = true;
    state.entityKind = null;
    return;
  }
  handleRichTextEntityHeading(state, text);
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
    state.current.details.push({ label: null, before: null, after: null, text });
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
    const duplicate = change.details.find((existing) => existing.label === detail.label
      && existing.before === detail.before && existing.after === detail.after
      && ((existing.before && existing.after) || existing.text === detail.text)
      && (!existing.component || !detail.component || existing.component === detail.component));
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
    state.current.details.push({ label: null, before: null, after: null, text });
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
  if (state.entityKind !== "system" || text.length > 110 || /[.!?]$/.test(text)) return false;
  if (!/(?:adjustments?|changes?|activity rules?|правки|изменени|правил|корректировк)/i.test(text)) return false;
  startRichTextEntity(state, "system", text, state.sectionName);
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
  if (state.entityKind === "system" && /^(?:turret plating|башенные пластины)$/i.test(text)) {
    state.currentSystemComponent = text;
    state.currentListComponent = null;
    return;
  }
  if (state.entityKind === "system" && /^(?:показатели|новые особенности)\b/i.test(text)) {
    state.currentSystemComponent = text.replace(/:\s*$/, "");
    state.currentListComponent = null;
    return;
  }
  if (handleRichTextSystemSpellParagraph(state, text)) return;
  if (handleRichTextSystemHeadingParagraph(state, text)) return;
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
  if (tag === "h2") {
    handleRichTextTopHeading(state, text);
    return true;
  }
  if (!["h3", "h4", "h5"].includes(tag)) return false;
  if (!state.ignoredGameMode && (isGameModeHeading(text)
    || /game mode changes|игровых? режим|режим приключени|арена|aaa\s*aram|отвязное безумие/i.test(text))) {
    flushRichTextChange(state);
    state.ignoredGameMode = true;
    state.entityKind = null;
    return true;
  }
  if (handleRichTextItemStatHeading(state, text, tag)) return true;
  if (tag === "h3" && state.current) flushRichTextChange(state);
  if (!state.ignoredGameMode) handleRichTextSubheading(state, text);
  return true;
}

function parseRichTextChanges(blade, catalog, explicitNewItemNames = new Set(), explicitNewRuneNames = new Set(), locale) {
  const html = extractRichText(blade);
  const $ = load(`<div>${html}</div>`, null, false);
  const blocks = $.root().children().first().find("h2,h3,h4,h5,p,li").toArray().filter((node) => {
    const tag = String(node.tagName || "").toLowerCase();
    const element = $(node);
    return !(tag === "li" && element.find("li").length)
      && !(tag === "p" && element.parents("li").length);
  });
  const state = createRichTextChangeState("", catalog, explicitNewItemNames, explicitNewRuneNames, locale);
  for (const node of blocks) {
    const text = cleanText($(node).text());
    if (!text) continue;
    handleRichTextNode(state, node, text, $, String(node.tagName || "").toLowerCase());
  }
  flushRichTextChange(state);
  return state.records;
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
  { champion: 'renekton', aliases: ['blackfrost renekton', 'ренектон черная стужа'], slug: 'renekton-blackfrost-renekton' },
  { champion: 'renekton', aliases: ['blackfrost renekton purple', 'ренектон черная стужа фиолетовыи'], slug: 'renekton-blackfrost-renekton-purple' },
  { champion: 'urgot', aliases: ['battlecast urgot', 'модифицированныи ургот'], slug: 'urgot-battlecast-urgot' },
  { champion: 'nasus', aliases: ['dream raider nasus', 'похититель снов насус'], slug: 'nasus-dream-raider-nasus' },
  { champion: 'nasus', aliases: ['unleashed dream raider nasus', 'вознесшийся похититель снов насус'], slug: 'nasus-unleashed-dream-raider-nasus' },
  { champion: 'thresh', aliases: ['dream raider thresh', 'похититель снов треш'], slug: 'thresh-dream-raider-thresh' },
  { champion: 'thresh', aliases: ['unleashed dream raider thresh', 'освобожденный похититель снов треш'], slug: 'thresh-unleashed-dream-raider-thresh' },
  { champion: 'amumu', aliases: ['food spirits amumu', 'гурман амуму'], slug: 'amumu-food-spirits-amumu' },
  { champion: 'amumu', aliases: ['ascended food spirits amumu', 'вознесшийся гурман амуму'], slug: 'amumu-ascended-food-spirits-amumu' },
  { champion: 'kayle', aliases: ['dragonslayer kayle', 'убийца драконов кейл'], slug: 'kayle-dragonslayer-kayle' },
  { champion: 'kayle', aliases: ['dragonslayer kayle amber', 'убийца драконов кейл янтарный'], slug: 'kayle-dragonslayer-kayle-amber' },
];

function getCanonicalAnnouncementSkinSlug(championSlug, skinName) {
  const normalized = normalizeEntityName(skinName);
  const skin = PATCH_SKIN_SLUGS.find((entry) => entry.champion === championSlug
    && entry.aliases.includes(normalized));
  return skin?.slug || `${championSlug}-${normalized.replace(/\s+/g, '-')}`;
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
  prefix = prefix.replace(/^.*?(?:на этот раз|вас ждут|получите|unlock(?: the)?|you can get|obtain|along with its upgraded version|вместе с его улучшенной версией|в главных ролях|all-new|(?:the )?new (?:season-exclusive |exclusive )?(?:skins?|skin)|new (?:season-exclusive |exclusive )?(?:skins?|skin)|season-exclusive skin|brand-new exclusive grand skin reward[^:]*?obtain|нов(?:ый|ые) (?:эксклюзивный )?(?:облик|образ)|эксклюзивный образ|образы?(?:\s+(?:мини-)?пропуска)?[^:]*:|доступны новые образы?\s*[–—:-]*|returning skins?[^:]*:|skins?[^:]*:|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+chromas?\s+(?:for|of)|featuring|starring)\s*/i, "");
  const afterChampion = source.slice(end);
  let skinSuffix = extractSkinSuffix(afterChampion, captureFollowingName);
  if (/^\s*(?:will|is|has|have|arrives?|выйдет|появится|будет|станет)\b/i.test(skinSuffix)) skinSuffix = "";
  const candidate = cleanText(`${prefix} ${source.slice(occurrence, end)} ${skinSuffix}`)
    .replace(/^["“«]|["”»]$/g, "")
    .replace(/^(?:the )?all-new\s+/i, "")
    .replace(/^(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+/i, "")
    .replace(/^(?:(?:its|their)\s+)?chroma\s+/i, "")
    .replace(/^(?:participate .*? to obtain|joining him will be)\s+/i, "")
    .replace(/^(?:образ|облик|skin)\s+/i, "");
  if (candidate.split(/\s+/).length < 2) return null;
  // Patch prose can mention an existing skin or start an unrelated example with
  // the champion's name. Such sentences are not cosmetic announcements.
  if (/^(?:(?:теперь|что|раньше|обновили|переработали|улучшили|изменили|изменения|модель|анимаци|визуальн|старые|новые|единственной|тогда|в рамках|в бой ворвется|для каждого|за каждые|в сундуках)(?:\s|$)|(?:you|now|previously|updated|reworked|improved|changes?|model|animation|visual|what|for every|including|the all new|we've also updated)\b)/i.test(candidate)
    || /(?:скорост[ьи] атаки|базов(?:ой|ая) скорост|attack speed|base attack|visual update|visuals of)/i.test(candidate)) return null;
  return candidate;
}

function createAnnouncementState(champions, add) {
  return { champions, add, inNewSection: false, inNewChampionSection: false, candidateChampion: null, ignoringMode: false, skinListMode: null };
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

function setAnnouncementH2(state, text) {
  state.ignoringMode = /game mode changes|игровых? режим|режим приключени|арена|aaa\s*aram|отвязное безумие/i.test(text);
  state.inNewSection = !state.ignoringMode && /^(?:new|новое)$/i.test(text);
  state.skinListMode = !state.ignoringMode && /^(?:skins?|облики|образы)$/i.test(text) ? 'new' : null;
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
  if (/game mode changes|игровых? режим|режим приключени|арена|aaa\s*aram|отвязное безумие/i.test(text)) {
    state.ignoringMode = true;
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
    || Boolean(skinListMode);
  return hasCue && (Boolean(skinListMode) || isReturningMiniPassSkin(text) || /(?:облик|образ(?!\s+жизни)|скин|skin|skins|цветов[а-яё]*\s+схем[а-яё]*|хроматик|chromas?|появится в игре|выйдет в игру|доступен|доступна|available|arrives?|joins? the game|releas(?:e|es|ed|ing)|в главных ролях)/i.test(text));
}

function getAnnouncementSkinFlags(text, champion, skinListMode) {
  const explicitReturning = /(?:returning\b|returns?\b|return track|возвраща[а-яё]* облик|повторн[а-яё]* (?:облик|образ|наград)|образы возвраща[а-яё]*)/i.test(text)
    || isReturningMiniPassSkin(text);
  const explicitNew = /(?:нов[а-яё]* (?:эксклюзивный )?(?:облик|образ)|эксклюзивн[а-яё]* (?:облик|образ)|new (?:season-exclusive |exclusive )?skins?|new skin|season-exclusive skin|brand-new exclusive grand skin|all-new|(?:wild pass|mini pass) arrives?.{0,100}(?:featuring|starring)|new .{0,60}(?:wild pass|mini pass).{0,100}(?:featuring|starring)|(?:wild pass|mini pass).{0,100}(?:premieres?|takes center stage|featuring|starring)|(?:releas(?:e|es|ed|ing)|joins? the game|available)|(?:пропуск|мини-пропуск).{0,100}(?:выйдет|ждет|будет ждать|появится|на сцену)|нового пропуска|в главных ролях|появится в игре|выйдет в игру|доступен|доступна)/i.test(text);
  const returning = explicitReturning || (skinListMode === 'returning' && !explicitNew);
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
    && normalizeEntityName(extractedTitle) !== normalizeEntityName(champion.name);
  if (flags.legendsChroma) return 'Legends Showdown Volibear chromas';
  if (flags.unnamedChromaSet) return `${hasNamedChromaSkin ? extractedTitle : champion.name} chromas`;
  return extractedTitle;
}

function shouldIgnoreAnnouncementSkin(text, alias, match) {
  if (/(?:information|информация).{0,40}(?:incorrect|wrong|неверн|ошибочн)/i.test(text)) return true;
  if (isAnnouncementChestSkinMention(text)) return true;
  if (/(?:has arrived on the rift|arrives on the rift|прибывает в ущелье|прибывает на рифт)/i.test(text)
    && !/(?:skin|облик|образ|скин)/i.test(text)) return true;
  if (/^-new\b/i.test(text.slice(match.index + alias.length))
    || /^a\s+$/i.test(text.slice(Math.max(0, match.index - 2), match.index))) return true;
  return false;
}

function makeAnnouncementSkinChange(text, champion, alias, match, skinListMode) {
  if (shouldIgnoreAnnouncementSkin(text, alias, match)) return null;
  const entityName = extractSkinName(text, alias, match.index, shouldCaptureFollowingSkinName(text, skinListMode));
  if (!entityName) return null;
  const flags = getAnnouncementSkinFlags(text, champion, skinListMode);
  if (flags.chromaOnly && !flags.unnamedChromaSet) return null;
  const skinName = getAnnouncementSkinTitle(entityName, champion, flags);
  if (normalizeEntityName(skinName) === normalizeEntityName(champion.name)) return null;
  return {
    entityKind: 'skin',
    entityName: skinName,
    entitySlug: getCanonicalAnnouncementSkinSlug(champion.slug, skinName),
    sourceChampionSlug: champion.slug,
    changeName: flags.returning ? 'returning' : flags.newSkin && !flags.legendsChroma && !flags.unnamedChromaSet && !isColorVariant(skinName) ? 'new' : 'available',
    sectionName: flags.returning ? 'Повторные облики' : 'Облики патча',
    details: [{ label: null, before: null, after: null, text: flags.legendsChroma || flags.unnamedChromaSet ? text : 'Облик доступен в патче.' }],
  };
}
function extractAnnouncementSkinChanges(text, champions, skinListMode) {
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
    .map(({ champion, alias, match }) => makeAnnouncementSkinChange(text, champion, alias, match, skinListMode))
    .filter(Boolean);
}

function handleAnnouncementNode(state, tag, text) {
  if (tag === 'h2') {
    setAnnouncementH2(state, text);
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
  for (const change of extractAnnouncementSkinChanges(text, state.champions, state.skinListMode)) state.add(change);
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
        if (change.entityKind === 'skin' && getSkinChangePriority(change.changeName) > getSkinChangePriority(existing.changeName)) {
          Object.assign(existing, change);
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
    } else if (!existing.sourceImageUrl && change.sourceImageUrl) {
      existing.sourceImageUrl = change.sourceImageUrl;
    }
  }
  return merged;
}

function parseAnnouncementChanges(blades, catalog) {
  const collector = createChangeCollector();
  const champions = uniqueChampions(catalog);
  for (const blade of Array.isArray(blades) ? blades : []) {
    const html = extractRichText(blade);
    if (!html) continue;
    const $ = load(`<div>${html}</div>`, null, false);
    const state = createAnnouncementState(champions, collector.add);
    const nodes = $.root().children().first().find('h2,h3,h4,h5,p,li').toArray();
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

function makeSkinTableChange(text, matchData, tableSkin, sourceImageUrl = null) {
  const { champion, alias, match } = matchData;
  if (/(?:has arrived on the rift|arrives on the rift|прибывает в ущелье|прибывает на рифт)/i.test(text)
    && !/(?:skin|облик|образ|скин)/i.test(text)) return null;
  const title = cleanSkinTitle(tableSkin
    ? text.replace(/(?:releasing|released|появится в игре|выйдет в игру|доступен|доступна).*$/i, '')
    : extractSkinName(text, alias, match.index));
  if (!title) return null;
  if (normalizeEntityName(title) === normalizeEntityName(champion.name)) return null;
  if (isAnnouncementChestSkinMention(text)) return null;
  const returning = /return(?:ing)?|returns|возвраща|повторн/i.test(text);
  const chroma = /\((?:pink|yellow|amber|purple)\)|\bchroma\b|хроматик/i.test(title);
  return {
    entityKind: 'skin',
    entityName: title,
    entitySlug: getCanonicalAnnouncementSkinSlug(champion.slug, title),
    sourceChampionSlug: champion.slug,
    ...(sourceImageUrl ? { sourceImageUrl } : {}),
    changeName: returning ? 'returning' : chroma || isColorVariant(title) ? 'available' : 'new',
    sectionName: returning ? 'Returning Skins' : 'SKINS',
    details: [{ label: null, before: null, after: null, text: tableSkin ? 'Облик указан в списке обликов патча.' : text }],
  };
}

function parseSkinTableParagraph(text, champions, hasSkinTable) {
  const { tableSkin, passSkin } = getSkinTableFlags(text, hasSkinTable);
  if (!tableSkin && !passSkin) return [];
  return findAllSkinAliasMatches(text, champions)
    .map((match) => makeSkinTableChange(text, match, tableSkin))
    .filter(Boolean);
}

function parseSkinImageCell($, node, champions) {
  const sourceImageUrl = safeRiotImageUrl($(node).find('img').first().attr('src'));
  if (!sourceImageUrl) return [];
  const caption = cleanText($(node).find('p').filter((_, paragraph) => !$(paragraph).find('img').length).text());
  return findAllSkinAliasMatches(caption, champions)
    .map((match) => makeSkinTableChange(caption, match, true, sourceImageUrl))
    .filter(Boolean);
}

function parseSkinTableChanges(blades, catalog) {
  const champions = uniqueChampions(catalog);
  const changes = [];
  let inSkinSection = false;
  for (const blade of Array.isArray(blades) ? blades : []) {
    const html = sanitizeRichText(extractRichText(blade));
    const $ = load(`<div>${html}</div>`, null, false);
    const nodes = $.root().children().first().find('h2,h3,h4,h5,td,p,li').toArray();
    for (const node of nodes) {
      const tag = String(node.tagName || '').toLowerCase();
      const text = cleanText($(node).text());
      if (!text) continue;
      if (['h2', 'h3', 'h4', 'h5'].includes(tag)) {
        if (/^(?:skins?|облики|образы)$/i.test(text)) inSkinSection = true;
        else if (tag === 'h2') inSkinSection = false;
        continue;
      }
      if (tag === 'td' && inSkinSection) {
        changes.push(...parseSkinImageCell($, node, champions));
        continue;
      }
      if (['p', 'li'].includes(tag)) {
        const paragraph = htmlToText($(node).html().replace(/<br\s*\/?\s*>/gi, ' '));
        changes.push(...parseSkinTableParagraph(paragraph, champions, inSkinSection));
      }
    }
  }
  return changes;
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

const PATCH_DEBUT_CHAMPIONS = {
  "7.0d": [{ slug: "mel", aliases: ["Mel", "Мэл"] }],
  "7.1": [{ slug: "ksante", aliases: ["K'Sante", "К'Санте"] }],
  "7.1e": [{ slug: "taliyah", aliases: ["Taliyah", "Талия"] }],
  "7.1g": [{ slug: "skarner", aliases: ["Skarner", "Скарнер"] }],
  "7.2": [{ slug: "yunara", aliases: ["Yunara", "Юнара"] }],
  "7.3": [{ slug: "hwei", aliases: ["Hwei", "Хвэй"] }],
};

const PATCH_DEBUT_ITEMS = {
  "7.0d": [
    { slug: "kraken-slayer", en: "Kraken Slayer", ru: "Убийца кракенов" },
    { slug: "knights-vow", en: "Knight's Vow", ru: "Клятва рыцаря" },
    { slug: "overlords-bloodmail", en: "Overlord's Bloodmail", ru: "Кровавая кольчуга господина" },
    { slug: "unending-despair", en: "Unending Despair", ru: "Бесконечное отчаяние" },
    { slug: "experimental-hexplate", en: "Experimental Hexplate", ru: "Экспериментальная хекстековая броня" },
  ],
  "7.2": [
    { slug: "shurelyas-battlesong", en: "Shurelya's Battlesong", ru: "Боевая песнь Шурелии" },
    { slug: "fated-ashes", en: "Fated Ashes", ru: "Роковой пепел" },
    { slug: "blackfire-torch", en: "Blackfire Torch", ru: "Факел темного огня" },
    { slug: "dusk-and-dawn", en: "Dusk and Dawn", ru: "Закат и рассвет" },
    { slug: "void-amethyst", en: "Void Amethyst", ru: "Аметист Бездны" },
    { slug: "cryptbloom", en: "Cryptbloom", ru: "Могильный цветок" },
    { slug: "bloodletters-curse", en: "Bloodletter's Curse", ru: "Проклятие кровопускателя" },
    { slug: "immortal-treads", en: "Immortal Treads", ru: "Бессмертные шаги" },
    { slug: "crimson-lucidity", en: "Crimson Lucidity", ru: "Алое просветление" },
    { slug: "spellslingers-shoes", en: "Spellslinger's Shoes", ru: "Сапоги заклинателя" },
    { slug: "chainlaced-crushers", en: "Chainlaced Crushers", ru: "Цепные крушители" },
    { slug: "gunmetal-greaves", en: "Gunmetal Greaves", ru: "Наголенники из орудийной стали" },
    { slug: "armored-advance", en: "Armored Advance", ru: "Тяжелое наступление" },
    { slug: "armorcrusher-boots", en: "Armorcrusher Boots", ru: "Ботинки крушителя брони" },
  ],
};

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
  return mergeSkinChangeRows([
    ...parseStructuredChanges(blades, catalog, locale),
    ...parseAnnouncementChanges(blades, catalog),
    ...parseSkinTableChanges(blades, catalog),
  ]).filter((change) => !isGameModeChange(change)
    && !(change.entityKind === "skin" && String(change.entityName || "").length > 100));
}

function isGameModeChange(change) {
  return /^(?:adventure mode|aaa aram|aram|arena|battlefest(?:\s+s\d+)?|sonic waves(?:\s+season theme)?|приключенческий режим)$/i.test(change.sectionName || "")
    || /^(?:training camp|custom mode|summoner(?:'|’)s rift|aaa aram|arena|aram|battlefest(?:\s+s\d+)?|sonic waves(?:\s+season theme)?)$/i.test(change.entityName || "");
}

function addRussianPatchSkins(changes, blades, version, locale) {
  if (locale !== "ru-ru") return;
  const text = (blades || []).map((blade) => htmlToText(extractRichText(blade))).join(" ");
  const additions = version === "7.2" ? [
    {
      pattern: /цветовые схемы\s+киберпоп[-–— ]?зои/i,
      entityName: "Киберпоп-Зои (цветовые схемы)",
      entitySlug: "zoe-cyber-pop-zoe-chromas",
      sourceChampionSlug: "zoe",
      changeName: "available",
      sectionName: "Облики патча",
      detail: "В новом сезоне можно получить цветовые схемы Киберпоп-Зои.",
    },
    {
      pattern: /модифицированным\s+насусом/i,
      entityName: "Модифицированный Насус",
      entitySlug: "nasus-battlecast-nasus",
      sourceChampionSlug: "nasus",
      changeName: "returning",
      sectionName: "Повторные облики",
      detail: "Облик доступен в повторном мини-пропуске.",
    },
  ] : version === "7.1" ? [
    {
      pattern: /вознесшаяся\s+боевая\s+душа\s+варус/i,
      entityName: "Вознесшаяся Боевая душа Варус",
      entitySlug: "varus-ascended-soul-fighter-varus",
      sourceChampionSlug: "varus",
      changeName: "new",
      sectionName: "Облики патча",
      detail: "Улучшенная версия нового образа пропуска Wild Rift.",
    },
  ] : [];
  for (const skin of additions) {
    if (!skin.pattern.test(text)) continue;
    const existing = changes.find((change) => change.entityKind === "skin"
      && normalizeEntityName(change.entityName) === normalizeEntityName(skin.entityName));
    if (existing) {
      existing.entitySlug = skin.entitySlug;
      existing.sourceChampionSlug = skin.sourceChampionSlug;
      existing.changeName = skin.changeName;
    } else {
      const { pattern: _pattern, detail, ...change } = skin;
      changes.push({
        entityKind: "skin",
        ...change,
        details: [{ label: null, before: null, after: null, text: detail }],
      });
    }
  }
}

function addPatchDebutChampions(changes, version, catalog, locale) {
  for (const debut of PATCH_DEBUT_CHAMPIONS[version] || []) {
    const entity = debut.aliases.map((alias) => catalog?.champions?.get(normalizeEntityName(alias))).find(Boolean);
    const existing = changes.find((change) => change.entityKind === "champion"
      && (change.entitySlug === debut.slug || debut.aliases.some((alias) => normalizeEntityName(change.entityName) === normalizeEntityName(alias))));
    const localizedName = debut.slug === "chogath"
      ? locale === "en-us" ? "Cho'Gath" : "Чо'Гат"
      : null;
    if (existing) {
      existing.entitySlug = debut.slug;
      if (localizedName) existing.entityName = localizedName;
      if (locale === "en-us" && debut.slug === "skarner") existing.entityName = "Skarner";
      existing.changeName = "new";
      if (!existing.details.length) existing.details.push({ label: null, before: null, after: null, text: "Новый чемпион." });
    } else {
      changes.push({
        entityKind: "champion",
        entityName: localizedName || (locale === "en-us" && debut.slug === "skarner" ? "Skarner" : entity?.name || debut.aliases[0]),
        entitySlug: debut.slug,
        changeName: "new",
        sectionName: "New Champions",
        details: [{ label: null, before: null, after: null, text: "Новый чемпион в этом патче." }],
      });
    }
  }
}

function addPatchDebutItems(changes, version, locale) {
  if (version === "7.2") {
    for (const change of changes) {
      if (change.entityKind === "item" && normalizeEntityName(change.entityName) === "malignance") {
        change.changeName = null;
      }
    }
  }
  for (const debut of PATCH_DEBUT_ITEMS[version] || []) {
    const name = locale === "ru-ru" ? debut.ru : debut.en;
    const existing = changes.find((change) => change.entityKind === "item"
      && (change.entitySlug === debut.slug || normalizeEntityName(change.entityName).startsWith(normalizeEntityName(name))));
    if (existing) {
      existing.entitySlug = debut.slug;
      existing.changeName = "new";
    } else {
      changes.push({
        entityKind: "item",
        entityName: name,
        entitySlug: debut.slug,
        changeName: "new",
        sectionName: locale === "ru-ru" ? "НОВЫЕ ПРЕДМЕТЫ" : "NEW ITEMS",
        details: [{ label: null, before: null, after: null, text: "New item." }],
      });
    }
  }
}

function correctUpcomingSkinStatus(change, version) {
  if (change.entityKind !== "skin") return;
  const slug = change.entitySlug || "";
  const name = normalizeEntityName(change.entityName);
  const timingUnconfirmed = version === "7.1"
    && (["ornn-choo-choo-ornn", "ornn-choo-choo-ornn-yellow", "master-yi-psy-ops-master-yi-special-edition"].includes(slug)
      || /^(?:машинист орн(?: желтый)?|мастер ии из пси отряда особое издание)$/.test(name));
  const scorpioPass = version === "7.2" && (/scorpio-deity/.test(slug) || /^Scorpio Deity(?: Ancient Wisdom)? Skarner$/i.test(change.entityName));
  const reindeerPass = version === "7.3" && (/reindeer-smolder/.test(slug) || /^Reindeer Smolder(?: \(Pink\))?$/i.test(change.entityName));
  if (timingUnconfirmed || scorpioPass || reindeerPass) change.changeName = null;
}

function correctRuneReleaseStatus(change) {
  if (change.entityKind !== "rune") return;
  if (change.entitySlug === "legend-haste" || /^(?:legend:\s*haste|легенда:\s*ускорение)$/i.test(change.entityName)) {
    change.changeName = "new";
  }
  if (change.entitySlug === "ingenious-hunter" || /^(?:ingenious hunter|изобретательный охотник)$/i.test(change.entityName)
    || change.details.some((detail) => /^(?:removed|удалено)$/i.test(detail.text.trim()))) {
    change.changeName = "removed";
  }
}

function ensureLegendTenacityRemoval(changes, locale) {
  if (changes.some((change) => change.entityKind === "rune" && change.entitySlug === "legend-tenacity")) return;
  changes.push({
    entityKind: "rune",
    entityName: locale === "en-us" ? "Legend: Tenacity" : "Легенда: стойкость",
    entitySlug: "legend-tenacity",
    changeName: "removed",
    sectionName: locale === "en-us" ? "RUNE ADJUSTMENTS" : "ИЗМЕНЕНИЯ РУН",
    details: [{
      label: null,
      before: null,
      after: null,
      text: locale === "en-us"
        ? "Removed and replaced by Legend: Haste."
        : "Удалена и заменена руной «Легенда: ускорение».",
    }],
  });
}

function correctRussianBootNames(changes, locale) {
  if (locale !== "ru-ru") return;
  const bootNames = new Map([
    ["immortal-treads", "Бессмертные шаги (улучшение Алчных наголенников)"],
    ["crimson-lucidity", "Алое просветление (улучшение Ионийских сапог просветления)"],
  ]);
  for (const change of changes) {
    const name = bootNames.get(change.entitySlug);
    if (change.entityKind === "item" && name) change.entityName = name;
  }
}

function correctRussianPatchSkinNames(changes, version, locale) {
  if (version !== "7.3b") return;
  for (const change of changes) {
    if (change.entityKind === "skin" && /legends-showdown-volibear-chromas/.test(change.entitySlug || "")) {
      change.entityName = locale === "ru-ru" ? "Гроза легенд Волибир (цветовые схемы)" : "Legends Showdown Volibear chromas";
    }
  }
}

function correctPatch71VarusSkinSlugs(changes, version) {
  if (version !== "7.1") return;
  const slugs = new Map([
    ["soul fighter varus", "varus-soul-fighter-varus"],
    ["боевая душа варус", "varus-soul-fighter-varus"],
    ["ascended soul fighter varus", "varus-ascended-soul-fighter-varus"],
    ["вознесшаяся боевая душа варус", "varus-ascended-soul-fighter-varus"],
  ]);
  for (const change of changes) {
    if (change.entityKind !== "skin") continue;
    const slug = slugs.get(normalizeEntityName(change.entityName));
    if (!slug) continue;
    change.entitySlug = slug;
    change.sourceChampionSlug = "varus";
  }
}

function addPatch73bSystemChanges(changes, locale) {
  const russian = locale === "ru-ru";
  changes.push({
    entityKind: "system",
    sectionName: russian ? "ИСПРАВЛЕНИЕ ОШИБОК" : "BUG FIXES",
    entityName: russian ? "Исправления ошибок" : "Bug fixes",
    changeName: null,
    details: (russian ? [
      "Исправлена ошибка, из-за которой эффект скорости атаки Диких стрел Юнталь иногда срабатывал некорректно.",
      "Исправлена ошибка, из-за которой активация Ловушки на йордлов снижала броню и сопротивление магии.",
      "Исправлена ошибка в описании 1-го умения Смолдера.",
      "Исправлена ошибка, связанная с дальностью применения 1-го умения Вейгара.",
    ] : [
      "Fixed an issue where Yun Tal Wildarrows' Attack Speed effect would occasionally trigger incorrectly.",
      "Fixed an issue where activating Yordle Snap Trap would reduce Armor and Magic Resist.",
      "Fixed an issue with the description of Smolder's (1).",
      "Fixed an issue with the cast range of Veigar's (1).",
    ]).map((text) => ({ label: null, before: null, after: null, text })),
  });
  changes.push({
    entityKind: "system",
    sectionName: russian ? "Прочие изменения" : "Other Adjustments",
    entityName: russian ? "Оптимизация правил таблицы лидеров среди гильдий" : "Guild Leaderboard Settlement Rules Optimization",
    changeName: null,
    details: [{
      label: null,
      before: null,
      after: null,
      text: russian
        ? "Очки таблицы лидеров гильдий рассчитываются каждый понедельник в 02:55 по московскому времени, а таблица обновляется в 03:00."
        : "Guild Leaderboard points are calculated at 11:55 PM every Sunday, and the leaderboard refreshes at 12:00 AM.",
    }],
  });
}

function replacePatch73bVolibearChromaRow(changes, locale) {
  const russian = locale === "ru-ru";
  const title = russian ? "Гроза легенд Волибир" : "Legends Showdown Volibear";
  const leagues = ["LPL", "LCK", "LEC", "LCS", "LCP", "CBLOL"];
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    if (change.entityKind === "skin" && /legends-showdown-volibear-chromas/.test(change.entitySlug || "")) changes.splice(index, 1);
  }
  for (const league of leagues) {
    changes.push({
      entityKind: "skin",
      entityName: `${title} (${league})`,
      entitySlug: `volibear-legends-showdown-volibear-${league.toLowerCase()}`,
      sourceChampionSlug: "volibear",
      changeName: "available",
      sectionName: russian ? "Облики патча" : "Patch Skins",
      details: [{
        label: null,
        before: null,
        after: null,
        text: russian
          ? `Цветовая схема ${title} (${league}) доступна в сундуке со случайной цветовой схемой. Шанс выпадения: 16,67%.`
          : `${title} (${league}) is available in the Random Chroma Chest, with a 16.67% drop chance.`,
      }],
    });
  }
  changes.push({
    entityKind: "system",
    sectionName: russian ? "Прочие изменения" : "Other Adjustments",
    entityName: russian ? `Сундуки с цветовыми схемами ${title}` : `${title} Chroma Chests`,
    changeName: null,
    details: (russian ? [
      `За каждые 10 счастливых сундуков с цветовыми схемами ${title} гарантированно выдается сундук со случайной цветовой схемой.`,
      "Шанс получить случайную цветовую схему: 5,83%; 200 ед. серебряной пыли: 11,07%; 100 ед.: 27,74%; 80 ед.: 33,22%; 60 ед.: 22,14%.",
      "Счастливые сундуки доступны в магазине обмена добычи за 10 оранжевых самоцветов, не более 60 штук; сундук со случайной цветовой схемой доступен в магазине Чемпионата мира за 120 оранжевых самоцветов и 970 значков «Мечтатель», 1 штука.",
    ] : [
      `Every 10 Legends Showdown Volibear Chroma Lucky Chests guarantee one Random Chroma Chest.`,
      "Random Chroma Chest: 5.83%; 200 Silver Stardust: 11.07%; 100: 27.74%; 80: 33.22%; 60: 22.14%.",
      "The Lucky Chest costs 10 Orange Gemstones and is limited to 60 purchases. The Random Chroma Chest costs 120 Wild Cores + 970 Dreamchaser Badges and is limited to one purchase.",
    ]).map((text) => ({ label: null, before: null, after: null, text })),
  });
}

function applyPatchSpecificCorrections(changes, version, locale) {
  for (const change of changes) {
    correctUpcomingSkinStatus(change, version);
    if (version === "7.3") correctRuneReleaseStatus(change);
  }
  if (version === "7.2c") {
    for (const change of changes) {
      if (change.entityKind !== "champion" || !/cho['’]?gath/i.test(change.entityName)) continue;
      change.entitySlug = "chogath";
      change.entityName = locale === "ru-ru" ? "Чо'Гат" : "Cho'Gath";
    }
  }
  if (version === "7.3") {
    ensureLegendTenacityRemoval(changes, locale);
    if (locale === "ru-ru") {
      for (const change of changes) {
        if (change.entityKind === "item" && change.entitySlug === "redemption") {
          change.entityName = "Искупление";
        }
      }
    }
  }
  if (version === "7.2") correctRussianBootNames(changes, locale);
  correctPatch71VarusSkinSlugs(changes, version);
  correctRussianPatchSkinNames(changes, version, locale);
  if (version === "7.3b") {
    addPatch73bSystemChanges(changes, locale);
    replacePatch73bVolibearChromaRow(changes, locale);
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
  const changes = parsePatchChanges(page.blades, catalog, locale);
  addRussianPatchSkins(changes, page.blades, version, locale);
  addPatchDebutChampions(changes, version, catalog, locale);
  addPatchDebutItems(changes, version, locale);
  applyPatchSpecificCorrections(changes, version, locale);
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
