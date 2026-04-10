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

function normalizeCnChampion(champion = {}) {
  return {
    slug: String(champion?.slug || "").trim() || null,
    cnHeroId: champion?.cnHeroId ? String(champion.cnHeroId).trim() : null,
    names: {
      ru_ru: champion?.names?.ru_ru || null,
      en_us: champion?.names?.en_us || null,
      zh_cn: champion?.names?.zh_cn || null,
    },
    roles: Array.isArray(champion?.roles) ? champion.roles.slice() : [],
    difficulty: champion?.difficulty || null,
    icon: champion?.icon || null,
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

  for (const [slug, localeNames] of ruMap.entries()) {
    riotCatalog.set(String(slug || "").trim(), {
      ru_ru: localeNames?.ru_ru || null,
      en_us: enMap.get(slug)?.en_us || null,
    });
  }

  for (const [slug, localeNames] of enMap.entries()) {
    if (ruMap.has(slug)) {
      continue;
    }

    enOnly.push(String(slug || "").trim());

    if (enMap.size > ruMap.size) {
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

  const champions = riotEntries.map(([riotSlug, localeNames = {}]) => {
    const normalizedRiotSlug = String(riotSlug || "").trim();
    riotSlugSet.add(normalizedRiotSlug);

    const cnChampion = cnByRiotSlug.get(normalizedRiotSlug) || null;
    const patch =
      (cnChampion?.slug && namePatches[cnChampion.slug]) ||
      namePatches[normalizedRiotSlug] ||
      null;

    return {
      slug: normalizedRiotSlug,
      cnHeroId: cnChampion?.cnHeroId || null,
      names: {
        ...normalizeLocaleNames(localeNames),
        zh_cn: cnChampion?.names?.zh_cn || null,
        ...(patch || {}),
      },
      roles: cnChampion?.roles || [],
      difficulty: cnChampion?.difficulty || null,
      icon: cnChampion?.icon || null,
    };
  });

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
