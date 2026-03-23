import path from "path";

import {
  buildAbilityMapper,
  loadChampionRecords,
  resolveAbility,
} from "./newsEntityMapper.mjs";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

let cachedAbilityAliasMap = null;

function getAbilityAliasMap() {
  if (cachedAbilityAliasMap) return cachedAbilityAliasMap;

  try {
    const championRecords = loadChampionRecords(path.resolve(process.cwd(), ".."));
    cachedAbilityAliasMap = buildAbilityMapper(championRecords).aliasToAbility;
  } catch (error) {
    console.warn("[newsImport] ability mapper unavailable:", error?.message || error);
    cachedAbilityAliasMap = new Map();
  }

  return cachedAbilityAliasMap;
}

function buildChampionSlugMap(championRows = []) {
  const map = new Map();

  for (const champion of championRows) {
    const slug = typeof champion?.slug === "string" ? champion.slug.trim() : "";
    if (!slug) continue;

    const candidates = new Set([slug]);
    if (typeof champion.name === "string" && champion.name.trim()) {
      candidates.add(champion.name);
    }

    if (champion.nameLocalizations && typeof champion.nameLocalizations === "object") {
      for (const value of Object.values(champion.nameLocalizations)) {
        if (typeof value === "string" && value.trim()) {
          candidates.add(value);
        }
      }
    }

    for (const candidate of candidates) {
      map.set(normalizeText(candidate), slug);
    }
  }

  return map;
}

function toIsoDateString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function normalizeEventType(value) {
  const raw = normalizeText(value);

  if (["buff", "up", "ap", "ап"].includes(raw)) return "buff";
  if (["nerf", "down", "нерф"].includes(raw)) return "nerf";
  if (["rework", "overhaul", "переработка"].includes(raw)) return "rework";
  if (["skin", "cosmetic", "скин"].includes(raw)) return "skin";
  if (["release", "new", "релиз"].includes(raw)) return "release";
  if (["adjustment", "change", "adjust", "изменение"].includes(raw)) return "adjustment";
  return "other";
}

function normalizeScope(value, eventType) {
  const raw = normalizeText(value);
  if (["ability", "spell", "skill"].includes(raw)) return "ability";
  if (["cosmetic", "skin"].includes(raw)) return "cosmetic";
  if (eventType === "skin") return "cosmetic";
  return "champion";
}

function buildStructuredChampionEvents(article, championSlugMap) {
  const sourceUrl = String(article?.sourceUrl || article?.normalizedUrl || "").trim();
  const eventDate = toIsoDateString(article?.publishedAt) || toIsoDateString(new Date());
  const championChanges = Array.isArray(article?.championChanges) ? article.championChanges : [];
  const abilityAliasMap = getAbilityAliasMap();
  const events = [];

  for (let champIndex = 0; champIndex < championChanges.length; champIndex += 1) {
    const championChange = championChanges[champIndex] || {};
    const championName = String(championChange.name || "").trim();
    const championSlug =
      championSlugMap.get(normalizeText(championChange.slug || championName)) || null;

    if (!championSlug) continue;

    const changes = Array.isArray(championChange.changes) ? championChange.changes : [];

    if (!changes.length) {
      const summaryText = clipText(championChange.summaryText, 280);
      events.push({
        championSlug,
        eventType: "adjustment",
        scope: "champion",
        title: clipText(`${championName}: изменения`, 160),
        summary: summaryText,
        details: {
          championName,
          summaryText: championChange.summaryText || null,
          roleLabel: championChange.roleLabel || null,
          imageUrl: championChange.imageUrl || null,
        },
        confidence: 0.98,
        sourceMethod: "riot-structured",
        dedupeKey: `${sourceUrl}:${championSlug}:adjustment:summary:${champIndex}`,
        eventDate,
      });
      continue;
    }

    for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
      const change = changes[changeIndex] || {};
      const descriptionText = clipText(change.descriptionText, 320);
      const abilityMatch = resolveAbility(abilityAliasMap, championSlug || championName, change.title);
      events.push({
        championSlug,
        eventType: "adjustment",
        scope: "ability",
        abilityName: clipText(change.title, 120),
        title: clipText(`${championName}: ${change.title || "изменение"}`, 160),
        summary: descriptionText,
        details: {
          championName,
          roleLabel: championChange.roleLabel || null,
          imageUrl: championChange.imageUrl || null,
          summaryText: championChange.summaryText || null,
          changeTitle: change.title || null,
          abilitySlug: abilityMatch?.abilitySlug || null,
          abilitySlot: abilityMatch?.slot || null,
          iconUrl: change.iconUrl || null,
          descriptionText: change.descriptionText || null,
        },
        confidence: 0.99,
        sourceMethod: "riot-structured",
        dedupeKey: `${sourceUrl}:${championSlug}:adjustment:${change.title || "change"}:${changeIndex}`,
        eventDate,
      });
    }
  }

  return events;
}

function normalizeExplicitEvents(rawEvents, article, championSlugMap) {
  const sourceUrl = String(article?.sourceUrl || article?.normalizedUrl || "").trim();
  const defaultDate = toIsoDateString(article?.publishedAt) || toIsoDateString(new Date());
  const abilityAliasMap = getAbilityAliasMap();
  const events = [];

  for (let index = 0; index < rawEvents.length; index += 1) {
    const raw = rawEvents[index] || {};
    const championSlug =
      championSlugMap.get(normalizeText(raw.championSlug || raw.championName || raw.slug)) || null;

    if (!championSlug) continue;

    const eventType = normalizeEventType(raw.eventType || raw.type);
    const scope = normalizeScope(raw.scope, eventType);
    const abilityName = clipText(raw.abilityName, 120);
    const skinName = clipText(raw.skinName, 120);
    const abilityMatch =
      scope === "ability"
        ? resolveAbility(abilityAliasMap, championSlug || raw.championName, abilityName)
        : null;
    const dedupeTail =
      abilityName || skinName || clipText(raw.title, 80) || clipText(raw.summary, 80) || `${index}`;

    events.push({
      championSlug,
      eventType,
      scope,
      abilityName,
      skinName,
      title: clipText(raw.title, 160),
      summary: clipText(raw.summary, 320),
      details:
        raw.details && typeof raw.details === "object"
          ? {
              ...raw.details,
              abilitySlug: raw.details.abilitySlug || abilityMatch?.abilitySlug || null,
              abilitySlot: raw.details.abilitySlot || abilityMatch?.slot || null,
            }
          : {
              championName: raw.championName || null,
              articleTitle: article?.title || null,
              abilitySlug: abilityMatch?.abilitySlug || null,
              abilitySlot: abilityMatch?.slot || null,
            },
      confidence:
        typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
          ? raw.confidence
          : null,
      sourceMethod: clipText(raw.sourceMethod, 60) || "flow",
      dedupeKey: `${sourceUrl}:${championSlug}:${eventType}:${dedupeTail}`,
      eventDate: toIsoDateString(raw.eventDate) || defaultDate,
    });
  }

  return events;
}

export function normalizeNewsImportPayload({ body, championRows }) {
  const articleInput = body?.article && typeof body.article === "object" ? body.article : body;

  const article = {
    sourceUrl: String(articleInput?.sourceUrl || articleInput?.url || "").trim(),
    normalizedUrl: clipText(articleInput?.normalizedUrl, 500),
    title: clipText(articleInput?.title, 300),
    description: clipText(articleInput?.description, 1000),
    category: clipText(articleInput?.categoryMachineName || articleInput?.category, 80),
    locale: clipText(articleInput?.locale, 40),
    publishedAt: articleInput?.publishedAt || null,
    contentId: clipText(articleInput?.contentId, 120),
    bodyText: typeof articleInput?.bodyText === "string" ? articleInput.bodyText.trim() : null,
    championChanges: Array.isArray(articleInput?.championChanges) ? articleInput.championChanges : [],
    rawPayload: articleInput,
  };

  if (!article.sourceUrl) {
    const error = new Error("Invalid article payload");
    error.statusCode = 400;
    throw error;
  }

  const championSlugMap = buildChampionSlugMap(championRows);
  const explicitEvents = Array.isArray(body?.events) ? body.events : [];

  const normalizedEvents = explicitEvents.length
    ? normalizeExplicitEvents(explicitEvents, article, championSlugMap)
    : buildStructuredChampionEvents(article, championSlugMap);

  return {
    article,
    events: normalizedEvents,
  };
}
