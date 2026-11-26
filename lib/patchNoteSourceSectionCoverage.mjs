import { load } from "cheerio";

function cleanText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function normalize(value) {
  return cleanText(value).normalize("NFKD").replace(/[\u0300-\u036f]/gu, "")
    .replace(/[’‘'`]/gu, "").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sourceTextContainsEntityName(sourceText, entityName) {
  const textWithInlineElementBoundary = String(sourceText || "").replace(/([\p{Ll}\p{N}])(?=\p{Lu})/gu, "$1 ");
  return ` ${normalize(textWithInlineElementBoundary)} `.includes(` ${entityName} `);
}

function getRiotBlades(html) {
  const $ = load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) throw new TypeError("Riot source is missing __NEXT_DATA__");
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new TypeError("Riot __NEXT_DATA__ is not valid JSON"); }
  const blades = payload?.props?.pageProps?.page?.blades;
  if (!Array.isArray(blades)) throw new TypeError("Riot __NEXT_DATA__ has no article blade inventory");
  return blades;
}

function inspectHtmlSection(html) {
  const $ = load(`<div>${String(html || "")}</div>`, null, false);
  const root = $.root().children().first();
  const sourceHeadings = root.find("h1,h2,h3,h4,h5,h6").toArray().map((node) => ({
    level: Number(String(node.tagName).slice(1)),
    title: cleanText($(node).text()),
  })).filter(({ title }) => title);
  const sourceTextBlocks = root.find("li,p,td,th").toArray()
    .filter((node) => {
      const tagName = String(node.tagName).toLowerCase();
      if (tagName === "p" && $(node).parents("li,td,th").length) return false;
      return true;
    })
    .map((node) => cleanText($(node).text())).filter(Boolean);
  const sourceChangeSignals = sourceTextBlocks.filter((text) => (
    /(?:→|->|\bfrom\b.{1,100}\bto\b|\b(?:increased|reduced|decreased|raised|lowered)\b.{1,100}\bto\b)/iu.test(text)
  ));
  return {
    sourceHeadings,
    sourceTextBlockCount: sourceTextBlocks.length,
    sourceTextBlockSamples: sourceTextBlocks.slice(0, 3).map((text) => text.slice(0, 240)),
    sourceChangeSignalCount: sourceChangeSignals.length,
    sourceChangeSignalSamples: sourceChangeSignals.slice(0, 3).map((text) => text.slice(0, 240)),
    _sourceTextBlocks: sourceTextBlocks,
  };
}

function riotCharacterSections(blade, bladeIndex) {
  const characters = Array.isArray(blade.characters) ? blade.characters : [];
  if (!characters.length) return [emptyRiotSection(blade, bladeIndex, "characterChanges")];
  return characters.map((entry, entryIndex) => {
    const character = entry?.character || entry || {};
    const title = cleanText(character.name || entry?.name || entry?.title) || `Character ${entryIndex + 1}`;
    const content = [entry?.summary?.body, ...(Array.isArray(entry?.changes) ? entry.changes.map((change) => change?.description?.body || change?.descriptionText) : [])]
      .filter(Boolean).join(" ");
    return {
      sourceIndex: bladeIndex,
      groupIndex: entryIndex,
      sourceType: "characterChanges",
      sourceHeading: title,
      sourceEntityNames: [title],
      parserSupported: true,
      sourceRecordCandidates: title === `Character ${entryIndex + 1}` ? 0 : 1,
      ...inspectHtmlSection(content),
    };
  });
}

function riotAccordionSections(blade, bladeIndex) {
  const groups = Array.isArray(blade.groups) ? blade.groups : [];
  const sections = groups.flatMap((group, groupIndex) => {
    const body = group?.content?.body;
    if (!body) return [];
    const label = cleanText(group.label);
    return [{
      sourceIndex: bladeIndex,
      groupIndex,
      sourceType: "articleRichTextAccordion",
      sourceHeading: label || cleanText(blade.fragmentId) || `Accordion ${groupIndex + 1}`,
      // Some Riot accordion templates use the entity name itself as the group
      // label (for example, a champion name above a details-only stat list).
      // Exact identity is useful evidence; generic labels like "CLICK TO
      // EXPAND" will simply fail to match any parsed entity.
      sourceEntityNames: label ? [label] : [],
      parserSupported: true,
      sourceRecordCandidates: null,
      ...inspectHtmlSection(body),
    }];
  });
  return sections.length ? sections : [emptyRiotSection(blade, bladeIndex, "articleRichTextAccordion")];
}

function riotRichTextSection(blade, bladeIndex, type) {
  const body = blade?.richText?.body || blade?.body || blade?.html || "";
  return {
    sourceIndex: bladeIndex,
    groupIndex: null,
    sourceType: type,
    sourceHeading: cleanText(blade.fragmentId || blade.title) || type,
    sourceEntityNames: [],
    parserSupported: true,
    sourceRecordCandidates: null,
    ...inspectHtmlSection(body),
  };
}

function riotUnsupportedSection(blade, bladeIndex, type) {
  // Keep every non-masthead blade visible in the inventory. New Riot blade
  // types with textual content are especially important for parser review.
  const textValues = collectTextValues(blade);
  const sourceChangeSignals = textValues.filter((text) => /(?:→|->|\bfrom\b.{1,100}\bto\b)/iu.test(text));
  return {
    sourceIndex: bladeIndex,
    groupIndex: null,
    sourceType: type,
    sourceHeading: cleanText(blade?.fragmentId || blade?.title || blade?.name) || type,
    sourceEntityNames: [],
    parserSupported: false,
    containsTextContent: textValues.length > 0,
    sourceTextBlockCount: textValues.length,
    sourceTextBlockSamples: textValues.slice(0, 3).map((text) => text.slice(0, 240)),
    sourceHeadings: [],
    sourceChangeSignalCount: sourceChangeSignals.length,
    sourceChangeSignalSamples: sourceChangeSignals.slice(0, 3).map((text) => text.slice(0, 240)),
    sourceRecordCandidates: null,
  };
}

function riotSectionEntries(blades) {
  return blades.flatMap((blade, bladeIndex) => {
    const type = cleanText(blade?.type) || "unknown";
    if (type === "articleMasthead") return [];
    if (/carousel|cardgrid|relatedarticles|separator|riotbar/iu.test(type)) return [];
    if (type === "characterChanges") return riotCharacterSections(blade, bladeIndex);
    if (type === "articleRichTextAccordion") return riotAccordionSections(blade, bladeIndex);
    if (type === "articleRichText" || type === "patchNotesRichText") return [riotRichTextSection(blade, bladeIndex, type)];
    if (!hasSourceContentField(blade)) return [];
    return [riotUnsupportedSection(blade, bladeIndex, type)];
  });
}

function emptyRiotSection(blade, sourceIndex, sourceType) {
  return {
    sourceIndex,
    groupIndex: null,
    sourceType,
    sourceHeading: cleanText(blade?.fragmentId || blade?.title) || sourceType,
    sourceEntityNames: [],
    parserSupported: true,
    sourceRecordCandidates: 0,
    sourceHeadings: [],
    sourceTextBlockCount: 0,
    sourceTextBlockSamples: [],
    sourceChangeSignalCount: 0,
    sourceChangeSignalSamples: [],
  };
}

function collectTextValues(value, output = []) {
  if (typeof value === "string") {
    const text = cleanText(value.replace(/<[^>]*>/gu, " "));
    if (text && !/^https?:\/\//iu.test(text)) output.push(text);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectTextValues(entry, output);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (["url", "src", "image", "media", "icon"].includes(key.toLowerCase())) continue;
      collectTextValues(entry, output);
    }
  }
  return output;
}

function hasSourceContentField(value) {
  if (Array.isArray(value)) return value.some(hasSourceContentField);
  if (!value || typeof value !== "object") return false;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:body|html|descriptionText|richText|content|changes|characters|groups|text|summary)$/iu.test(key)
      && collectTextValues(entry).some((text) => text.length > 20)) return true;
    if (hasSourceContentField(entry)) return true;
  }
  return false;
}

function riotMatchScore(section, change) {
  const entityIdentities = [change.entityName, change.entitySlug].map(normalize).filter(Boolean);
  const sectionNames = cleanText(change.sectionName).split(/[·/›>]+/u).map(normalize).filter(Boolean);
  const sourceEntityNames = section.sourceEntityNames.map(normalize).filter(Boolean);
  const aliases = [section.sourceHeading, ...section.sourceHeadings.map(({ title }) => title)].map(normalize).filter(Boolean);
  if (entityIdentities.some((identity) => sourceEntityNames.includes(identity))) return 10;
  if (sectionNames.some((sectionName) => aliases.includes(sectionName))) return 8;
  if (entityIdentities.some((identity) => aliases.some((alias) => sourceTextContainsEntityName(alias, identity)))) return 7;
  if (entityIdentities.some((identity) => section._sourceTextBlocks?.some((text) => sourceTextContainsEntityName(text, identity)))) return 6;
  return 0;
}

function buildRiotCoverage(html, article) {
  const sections = riotSectionEntries(getRiotBlades(html));
  const parsedChanges = Array.isArray(article?.changes) ? article.changes : [];
  const parsedBySection = sections.map(() => []);
  const unmatchedParsedRecords = [];
  const ambiguousParsedRecords = [];
  const ambiguousSectionIndexes = new Set();
  for (const change of parsedChanges) {
    let bestScore = 0;
    let bestIndexes = [];
    sections.forEach((section, index) => {
      const score = riotMatchScore(section, change);
      if (score > bestScore) { bestIndexes = [index]; bestScore = score; }
      else if (score > 0 && score === bestScore) bestIndexes.push(index);
    });
    const record = { entityKind: change.entityKind || "unknown", entityName: change.entityName || null, sectionName: change.sectionName || null };
    if (!bestIndexes.length) unmatchedParsedRecords.push(record);
    else if (bestIndexes.length > 1) {
      ambiguousParsedRecords.push({
        ...record,
        matchScore: bestScore,
        candidateSections: bestIndexes.map((index) => ({
          sourceIndex: sections[index].sourceIndex,
          groupIndex: sections[index].groupIndex,
          sourceType: sections[index].sourceType,
          sourceHeading: sections[index].sourceHeading,
        })),
      });
      for (const index of bestIndexes) ambiguousSectionIndexes.add(index);
    } else parsedBySection[bestIndexes[0]].push(change);
  }
  const inventory = sections.map((section, index) => {
    const records = parsedBySection[index];
    const { _sourceTextBlocks, ...publicSection } = section;
    return {
      ...publicSection,
      parsedRecordCount: records.length,
      parsedRecordSamples: records.slice(0, 12).map(({ entityKind, entityName, sectionName }) => ({ entityKind, entityName, sectionName })),
      reviewStatus: !section.parserSupported ? "unsupported-source-blade"
        : ambiguousSectionIndexes.has(index) ? "ambiguous-source-association-review"
        : section.sourceTextBlockCount > 0 && records.length === 0 ? "content-without-associated-records-review"
          : records.length === 0 ? "no-associated-records"
            : "records-associated",
    };
  });
  return {
    source: "riot",
    inventoryMethod: "raw __NEXT_DATA__ article blades, character entries, and rich-text heading/text inventory",
    sourceSectionCount: inventory.length,
    sourceTextBlockCount: inventory.reduce((count, section) => count + section.sourceTextBlockCount, 0),
    sourceChangeSignalCount: inventory.reduce((count, section) => count + section.sourceChangeSignalCount, 0),
    parsedRecordCount: parsedChanges.length,
    associatedParsedRecordCount: parsedChanges.length - unmatchedParsedRecords.length - ambiguousParsedRecords.length,
    unmatchedParsedRecords,
    ambiguousParsedRecords,
    sections: inventory,
  };
}

function extractRpnCard(card, $) {
  const event = card.find('[data-umami-event^="patch-"]').first();
  const eventName = cleanText(event.attr("data-umami-event"));
  const nameLink = card.find('[data-umami-event^="patch-"]').filter((_, node) => cleanText($(node).text())).first();
  const href = nameLink.attr("href") || "";
  return {
    entityKind: eventName.match(/^patch-([a-z-]+)-click$/iu)?.[1] || null,
    entitySlug: cleanText(event.attr("data-umami-event-slug") || href.match(/^\/(?:champion|item|rune|spell|skin|system)\/([^/?#]+)/iu)?.[1] || card.attr("id")) || null,
    entityName: cleanText(nameLink.text()) || null,
  };
}

function buildRpnIdentityIndexes(parsedChanges) {
  const parsedByIdentityAndKind = new Map();
  const parsedByIdentity = new Map();
  parsedChanges.forEach((change, index) => {
    const identity = normalize(change.entitySlug || change.entityName);
    if (!identity) return;
    const kind = normalize(change.entityKind || "unknown");
    const record = { index, change, identity, kind };
    const key = `${kind}\u0000${identity}`;
    parsedByIdentityAndKind.set(key, [...(parsedByIdentityAndKind.get(key) || []), record]);
    parsedByIdentity.set(identity, [...(parsedByIdentity.get(identity) || []), record]);
  });
  return { parsedByIdentityAndKind, parsedByIdentity };
}

function matchRpnSourceCard(card, indexes, associatedParsedIndexes) {
  const identity = normalize(card.entitySlug || card.entityName);
  const kind = normalize(card.entityKind);
  const exactKey = `${kind}\u0000${identity}`;
  const candidates = !identity ? [] : (kind
    ? indexes.parsedByIdentityAndKind.get(exactKey) || []
    : indexes.parsedByIdentity.get(identity) || []);
  const available = candidates.filter(({ index }) => !associatedParsedIndexes.has(index));
  const match = available.length === 1 ? available[0] : null;
  const entityKindMismatch = Boolean(kind && identity && available.length === 0
    && (indexes.parsedByIdentity.get(identity) || []).some(({ kind: parsedKind }) => parsedKind !== kind));
  const ambiguousParsedMatchCount = !match && !kind && available.length > 1 ? available.length : 0;
  if (match) associatedParsedIndexes.add(match.index);
  return {
    ...card,
    parsedRecordCount: match ? 1 : 0,
    ambiguousParsedMatchCount,
    entityKindMismatch,
  };
}

function summarizeRpnSourceSection(section, indexes, associatedParsedIndexes) {
  const cards = section.sourceCards.map((card) => matchRpnSourceCard(card, indexes, associatedParsedIndexes));
  const duplicateSourceCards = [];
  const matchedSourceCards = new Set();
  for (const card of cards) {
    const identity = normalize(card.entitySlug || card.entityName);
    if (!identity) continue;
    const key = `${normalize(card.entityKind || "unknown")}\u0000${identity}`;
    if (card.parsedRecordCount) matchedSourceCards.add(key);
    else if (matchedSourceCards.has(key)) {
      duplicateSourceCards.push({ entityKind: card.entityKind, entitySlug: card.entitySlug, entityName: card.entityName });
    }
  }
  return {
    sourceHeading: section.sourceHeading,
    sourceCardCount: cards.length,
    parsedRecordCount: cards.reduce((count, card) => count + card.parsedRecordCount, 0),
    unmatchedSourceCards: cards.filter((card) => card.parsedRecordCount === 0).map(({ entityKind, entitySlug, entityName }) => ({ entityKind, entitySlug, entityName })),
    duplicateSourceCards,
    ambiguousSourceCards: cards.filter((card) => card.ambiguousParsedMatchCount > 0).map(({ entityKind, entitySlug, entityName, ambiguousParsedMatchCount }) => ({ entityKind, entitySlug, entityName, candidateCount: ambiguousParsedMatchCount })),
    entityKindMismatchSourceCards: cards.filter((card) => card.entityKindMismatch).map(({ entityKind, entitySlug, entityName }) => ({ entityKind, entitySlug, entityName })),
  };
}

function buildRpnCoverage(html, article) {
  const $ = load(html);
  const content = $("#patch-content").first().length ? $("#patch-content").first() : $("#main-content").first();
  const sections = [];
  let current = null;
  for (const node of content.find("h2, .highlight-target[id]").toArray()) {
    const element = $(node);
    if (String(node.tagName || "").toLowerCase() === "h2") {
      current = { sourceHeading: cleanText(element.text()), sourceCards: [] };
      sections.push(current);
    } else {
      if (!current) {
        current = { sourceHeading: "[Unsectioned]", sourceCards: [] };
        sections.push(current);
      }
      current.sourceCards.push(extractRpnCard(element, $));
    }
  }
  const parsedChanges = Array.isArray(article?.changes) ? article.changes : [];
  const indexes = buildRpnIdentityIndexes(parsedChanges);
  const associatedParsedIndexes = new Set();
  const inventory = sections.map((section) => summarizeRpnSourceSection(section, indexes, associatedParsedIndexes));
  const unmatchedParsedRecords = parsedChanges.flatMap((change, index) => associatedParsedIndexes.has(index) ? [] : [{
    entityKind: change.entityKind || "unknown",
    entitySlug: change.entitySlug || null,
    entityName: change.entityName || null,
    sectionName: change.sectionName || null,
  }]);
  const sourceCardCount = inventory.reduce((count, section) => count + section.sourceCardCount, 0);
  const associatedRecordCount = associatedParsedIndexes.size;
  return {
    source: "rift-patch-notes",
    inventoryMethod: "source h2 headings and highlight-target cards matched one-to-one by entity kind and normalized slug/name",
    sourceSectionCount: inventory.length,
    sourceCardCount,
    parsedRecordCount: parsedChanges.length,
    associatedParsedRecordCount: associatedRecordCount,
    unmatchedParsedRecords,
    explicitNoChangeNotice: Boolean(article?.noChangeNotice),
    sections: inventory,
  };
}

/**
 * Report source structure beside parser output. This is review evidence, not a
 * semantic correctness verdict: Riot rich-text headings are not always entity cards.
 */
export function buildPatchNoteSourceSectionCoverage({ source, html, article }) {
  if (typeof html !== "string" || !html.trim()) throw new TypeError("Patch-note source HTML must be non-empty");
  if (source === "riot") return buildRiotCoverage(html, article);
  if (source === "rpn" || source === "rift-patch-notes") return buildRpnCoverage(html, article);
  throw new TypeError(`Unsupported patch-note source for section inventory: ${source}`);
}
