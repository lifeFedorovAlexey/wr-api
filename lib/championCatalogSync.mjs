import { mapToRiotSlug } from "../utils/slugRemap.mjs";

function toEntries(riotNames) {
  if (riotNames instanceof Map) {
    return Array.from(riotNames.entries());
  }

  if (riotNames && typeof riotNames === "object") {
    return Object.entries(riotNames);
  }

  return [];
}

function normalizeLocaleNames(localeNames = {}) {
  return {
    ru_ru: localeNames?.ru_ru || null,
    en_us: localeNames?.en_us || null,
  };
}

function cloneLocaleMap(localeMap) {
  if (localeMap instanceof Map) {
    return new Map(localeMap);
  }

  if (localeMap && typeof localeMap === "object") {
    return new Map(Object.entries(localeMap));
  }

  return new Map();
}

function trimToNull(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function cloneList(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function normalizeChampionNames(names = {}) {
  return {
    ru_ru: names?.ru_ru || null,
    en_us: names?.en_us || null,
    zh_cn: names?.zh_cn || null,
  };
}

function normalizeCnChampion(champion = {}) {
  return {
    slug: trimToNull(champion?.slug),
    cnHeroId: trimToNull(champion?.cnHeroId),
    names: normalizeChampionNames(champion?.names),
    roles: cloneList(champion?.roles),
    difficulty: champion?.difficulty || null,
    icon: champion?.icon || null,
  };
}

function buildRiotLocaleEntry(slug, ruMap, enMap) {
  return {
    slug: String(slug || "").trim(),
    names: {
      ru_ru: ruMap.get(slug)?.ru_ru || null,
      en_us: enMap.get(slug)?.en_us || null,
    },
  };
}

function shouldIncludeEnOnlyChampion(ruMap, enMap) {
  return enMap.size > ruMap.size;
}

function resolveChampionNamePatch(namePatches, normalizedRiotSlug, cnChampion) {
  if (cnChampion?.slug && namePatches[cnChampion.slug]) {
    return namePatches[cnChampion.slug];
  }

  return namePatches[normalizedRiotSlug] || null;
}

function buildChampionNames(localeNames, cnChampion, patch) {
  return {
    ...normalizeLocaleNames(localeNames),
    zh_cn: cnChampion?.names?.zh_cn || null,
    ...(patch || {}),
  };
}

export function buildRiotChampionCatalog({
  ruNames,
  enNames,
} = {}) {
  const ruMap = cloneLocaleMap(ruNames);
  const enMap = cloneLocaleMap(enNames);
  const riotCatalog = new Map();
  const ruOnly = [];
  const enOnly = [];

  for (const slug of ruMap.keys()) {
    const entry = buildRiotLocaleEntry(slug, ruMap, enMap);
    riotCatalog.set(entry.slug, entry.names);
  }

  for (const [slug, localeNames] of enMap.entries()) {
    if (ruMap.has(slug)) {
      continue;
    }

    enOnly.push(String(slug || "").trim());

    if (shouldIncludeEnOnlyChampion(ruMap, enMap)) {
      riotCatalog.set(String(slug || "").trim(), {
        ru_ru: null,
        en_us: localeNames?.en_us || null,
      });
    }
  }

  for (const slug of ruMap.keys()) {
    if (!enMap.has(slug)) {
      ruOnly.push(String(slug || "").trim());
    }
  }

  return {
    riotNames: riotCatalog,
    diagnostics: {
      ruCount: ruMap.size,
      enCount: enMap.size,
      mergedCount: riotCatalog.size,
      addedFromEnOnly: enMap.size > ruMap.size ? enOnly.slice() : [],
      enOnly,
      ruOnly,
    },
  };
}

export function buildChampionCatalogFromSources({
  riotNames,
  cnChampions = [],
  namePatches = {},
} = {}) {
  const riotEntries = toEntries(riotNames);
  const riotSlugSet = new Set();
  const cnByRiotSlug = new Map();
  const duplicateCnMappings = [];

  for (const champion of Array.isArray(cnChampions) ? cnChampions : []) {
    const normalizedChampion = normalizeCnChampion(champion);
    if (!normalizedChampion.slug) {
      continue;
    }

    const riotSlug = mapToRiotSlug(normalizedChampion.slug);
    if (!riotSlug) {
      continue;
    }

    if (cnByRiotSlug.has(riotSlug)) {
      duplicateCnMappings.push({
        riotSlug,
        keptSlug: cnByRiotSlug.get(riotSlug)?.slug || null,
        ignoredSlug: normalizedChampion.slug,
      });
      continue;
    }

    cnByRiotSlug.set(riotSlug, normalizedChampion);
  }

  function buildChampionEntry([riotSlug, localeNames = {}]) {
    const normalizedRiotSlug = String(riotSlug || "").trim();
    riotSlugSet.add(normalizedRiotSlug);

    const cnChampion = cnByRiotSlug.get(normalizedRiotSlug) || null;
    const patch = resolveChampionNamePatch(namePatches, normalizedRiotSlug, cnChampion);

    return {
      slug: normalizedRiotSlug,
      cnHeroId: cnChampion?.cnHeroId || null,
      names: buildChampionNames(localeNames, cnChampion, patch),
      roles: cnChampion?.roles || [],
      difficulty: cnChampion?.difficulty || null,
      icon: cnChampion?.icon || null,
    };
  }

  const champions = riotEntries.map(buildChampionEntry);

  const missingCnDetails = champions
    .filter((champion) => !champion.cnHeroId)
    .map((champion) => champion.slug);

  const excludedCnOnly = Array.from(cnByRiotSlug.entries())
    .filter(([riotSlug]) => !riotSlugSet.has(riotSlug))
    .map(([riotSlug, champion]) => ({
      cnSlug: champion.slug,
      riotSlug,
    }));

  return {
    champions,
    diagnostics: {
      riotChampionCount: champions.length,
      cnChampionCount: Array.isArray(cnChampions) ? cnChampions.length : 0,
      missingCnDetails,
      excludedCnOnly,
      duplicateCnMappings,
    },
  };
}
