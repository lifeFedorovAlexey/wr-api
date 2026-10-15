import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";

export const PATCH_NOTES_PARSER_VERSION = 16;

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
  const titleMatch = String(title || "").match(/\b(?:patch(?:\s+notes)?|патч(?:-ноты|а)?)\s*(\d+)\s*[.\- ]\s*(\d+)([a-z])?\b/i);
  if (titleMatch) return `${titleMatch[1]}.${titleMatch[2]}${titleMatch[3] || ""}`.toLowerCase();

  const pathMatch = String(url).match(/patch-notes-(\d+)-(\d+)([a-z])?(?:\/|$)/i);
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
  const split = text.match(/^([^:]{1,90}):\s*(.*?)\s*(?:→|->)\s*(.*?)$/);
  if (!split) return { label: null, before: null, after: null, text };
  return {
    label: cleanText(split[1]),
    before: cleanText(split[2]),
    after: cleanText(split[3]),
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
  if (/\bitems?\b|предмет/.test(value)) return "item";
  if (/\bnew champions?\b|\bchampions? (?:added|introduced)\b|нов(?:ый|ые) чемпион/.test(value)) return "champion";
  if (/\bremoved champions?\b|\bdeleted champions?\b|удален\w* чемпион|убран\w* чемпион/.test(value)) return "champion";
  if (/\brunes?\b|рун/.test(value)) return "rune";
  if (/monster|battlefield|jungle|dragon|game mode|gameplay|обитател|лес|дракон|пол(?:е|я) боя|игровых? режим|игрового процесса/.test(value)) return "system";
  return null;
}

function isEntityHeading(value) {
  const text = cleanText(value);
  if (!text || text.length > 90 || /[.!?;:→]/.test(text)) return false;
  return !/^(basic|core|base|additional) stats$|^(основные|базовые|дополнительные) параметры$|^(active|passive|активное|пассивное)$/i.test(text);
}

function isItemComponentHeading(value) {
  return /^(?:basic|core|base|additional) stats$|^(?:основные|базовые|дополнительные) (?:параметры|показатели|характеристики)$|^(?:active|passive|active ability|passive ability|активное|пассивное|активная способность|пассивная способность|шок)$/i
    .test(cleanText(value));
}

function isItemSectionHeading(value) {
  return /^(?:new|removed|deleted|changes to|item) items?$|^(?:новые|удаленные) предметы$|^изменения предметов$/i
    .test(cleanText(value));
}

function isGameModeHeading(value) {
  return /^(?:aaa\s+aram|aram|арена|отвязное безумие|аркадный режим|arena)$/i.test(cleanText(value));
}

function isSystemSubsectionHeading(value) {
  return /^(?:changes? to )?(?:augmentations?|battlefield|map|срок доступа|изменения (?:аугментаций|на поле боя)|новые аугментации|синхронизация аугментаций|механика связи)/i
    .test(cleanText(value));
}

function parseRichTextChanges(blade, catalog) {
  const html = extractRichText(blade);
  const $ = load(`<div>${html}</div>`, null, false);
  const blocks = $.root().children().first().find("h2,h3,h4,h5,p,li").toArray().filter((node) => {
    const tag = String(node.tagName || "").toLowerCase();
    const element = $(node);
    if (tag === "li" && element.find("li").length) return false;
    if (tag === "p" && element.parents("li").length) return false;
    return true;
  });
  const records = [];
  let sectionName = "";
  let entityKind = null;
  let rootSectionName = "";
  let rootEntityKind = null;
  let nestedItemSection = false;
  let current = null;
  let currentSystemComponent = null;
  let currentListComponent = null;

  const flush = () => {
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
    } else if (current?.details.length) {
      records.push(current);
    }
    current = null;
  };

  for (const node of blocks) {
    const tag = String(node.tagName || "").toLowerCase();
    const text = cleanText($(node).text());
    if (!text) continue;

    if (tag === "h2") {
      flush();
      sectionName = text;
      entityKind = getArticleChangeKind(sectionName);
      rootSectionName = sectionName;
      rootEntityKind = entityKind;
      nestedItemSection = false;
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "h3") {
      if (rootEntityKind) {
        flush();
        if (isItemSectionHeading(text)) {
          entityKind = "item";
          sectionName = text;
          nestedItemSection = true;
          currentSystemComponent = null;
          currentListComponent = null;
          continue;
        }
        if (/^(?:new|removed|deleted) champions?$|^(?:новые|удаленные) чемпионы$|^изменения чемпионов$/i.test(text)) {
          entityKind = "champion";
          sectionName = text;
          nestedItemSection = false;
          currentSystemComponent = null;
          currentListComponent = null;
          continue;
        }
        if (nestedItemSection && !isGameModeHeading(text)) {
          entityKind = "item";
          current = { entityKind, sectionName, entityName: text, changeName: null, details: [] };
          currentSystemComponent = null;
          currentListComponent = null;
          continue;
        }
        sectionName = rootSectionName;
        entityKind = rootEntityKind;
        nestedItemSection = false;
        current = { entityKind, sectionName, entityName: text, changeName: null, details: [] };
        currentSystemComponent = null;
        currentListComponent = null;
      }
      continue;
    }
    if (tag === "h4" && entityKind === "system" && isItemSectionHeading(text)) {
      flush();
      sectionName = text;
      entityKind = "item";
      nestedItemSection = true;
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "h4" && nestedItemSection && isSystemSubsectionHeading(text)) {
      flush();
      sectionName = rootSectionName;
      entityKind = rootEntityKind;
      nestedItemSection = false;
      current = { entityKind, sectionName, entityName: text, changeName: null, details: [] };
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "h4" && entityKind) {
      flush();
      current = {
        entityKind,
        sectionName,
        entityName: text,
        changeName: null,
        details: [],
        splitAsEntities: (entityKind === "item" || entityKind === "champion")
          && /^(?:removed|удалено|удаленные (?:предметы|чемпионы))$/i.test(text),
      };
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "h5" && entityKind && isEntityHeading(text)) {
      flush();
      current = { entityKind, sectionName, entityName: text, changeName: null, details: [] };
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "p" && entityKind === "system" && /^(?:показатели|новые особенности)\b/i.test(text)) {
      currentSystemComponent = text.replace(/:\s*$/, "");
      currentListComponent = null;
      continue;
    }
    if (tag === "p" && entityKind === "item" && rootEntityKind === "item" && current
      && catalog?.items?.has(normalizeEntityName(text))) {
      flush();
      current = { entityKind, sectionName, entityName: text, changeName: null, details: [] };
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "p" && entityKind === "item" && isItemComponentHeading(text)) {
      currentSystemComponent = text.replace(/:\s*$/, "");
      continue;
    }
    if (tag === "p" && entityKind === "item" && rootEntityKind === "item" && isEntityHeading(text)) {
      flush();
      current = { entityKind, sectionName, entityName: text, changeName: null, details: [] };
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "p" && entityKind && isEntityHeading(text)) {
      flush();
      current = { entityKind, sectionName, entityName: text, changeName: null, details: [] };
      currentSystemComponent = null;
      currentListComponent = null;
      continue;
    }
    if (tag === "li" && entityKind) {
      if (!current) {
        current = {
          entityKind,
          sectionName,
          entityName: sectionName,
          changeName: null,
          details: [],
          splitAsEntities: (entityKind === "item" && /\bremoved items\b|удаленные предметы/i.test(sectionName))
            || (entityKind === "champion" && /\bremoved champions\b|удаленные чемпионы/i.test(sectionName)),
        };
      }
      const namedStats = entityKind === "system" ? splitNamedStatHeading(text) : null;
      if (namedStats?.component) currentListComponent = namedStats.component;
      if (entityKind === "system" && currentListComponent && !namedStats
        && !/^(?:здоровье|сила атаки|броня|сопротивление магии)\s*:/i.test(text)) {
        currentListComponent = null;
      }
      const detailText = namedStats?.text || text;
      const components = entityKind === "system" ? nestedListComponents(node, $) : [];
      const component = components.length
        ? components.join(" — ")
        : namedStats?.component || currentListComponent || currentSystemComponent;
      const details = parseRichTextDetail(detailText).map((detail) => (
        component ? { ...detail, component } : detail
      ));
      current.details.push(...details);
    }
  }
  flush();
  return records;
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

function parseStructuredChanges(blades, catalog) {
  return (Array.isArray(blades) ? blades : []).flatMap((blade) => {
    if (blade?.type === "characterChanges") return parseChampionChanges(blade);
    if (blade?.type === "articleRichText" || blade?.type === "patchNotesRichText") return parseRichTextChanges(blade, catalog);
    return [];
  });
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

export function parsePatchArticle(html, expectedVersion, locale, catalog) {
  const page = readNextData(html);
  const masthead = page.blades.find((blade) => blade?.type === "articleMasthead");
  const title = cleanText(masthead?.title || page.title);
  const version = extractPatchVersion(title, page.url || "");
  if (!title || !version || version !== expectedVersion) {
    throw new Error(`Riot article version mismatch (expected ${expectedVersion}, found ${version || "none"})`);
  }

  const sections = page.blades.flatMap(parseArticleBlade);
  const changes = parseStructuredChanges(page.blades, catalog);

  const hasMeaningfulChanges = sections.some((section) =>
    section.kind === "champion"
    || /<h[2-5]\b/i.test(section.html)
    || (section.heading && !/^introduction$/i.test(section.heading)),
  );
  if (!hasMeaningfulChanges) {
    throw new Error("Riot article parsed without a change section (only masthead/introduction found)");
  }
  return {
    version,
    locale,
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
