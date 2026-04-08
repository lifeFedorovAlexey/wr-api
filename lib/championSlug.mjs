const CHAMPION_SLUG_RULES = [
  {
    canonical: "nunu-willump",
    legacyLocal: "nunu",
    sources: {
      riot: ["nunu-willump"],
      wildriftfire: ["nunu-willump"],
      riftgg: ["nunu-and-willump"],
      legacyLocal: ["nunu"],
      cn: ["nunu"],
    },
  },
  {
    canonical: "wukong",
    legacyLocal: "monkeyking",
    sources: {
      riot: ["wukong"],
      wildriftfire: ["wukong"],
      riftgg: ["wukong"],
      legacyLocal: ["monkeyking"],
      cn: ["monkeyking"],
    },
  },
  {
    canonical: "xin-zhao",
    legacyLocal: "xinzhao",
    sources: {
      riot: ["xin-zhao"],
      wildriftfire: ["xin-zhao"],
      riftgg: ["xin-zhao"],
      legacyLocal: ["xinzhao"],
      cn: ["xinzhao"],
    },
  },
  {
    canonical: "aurelion-sol",
    legacyLocal: "aurelionsol",
    sources: {
      riot: ["aurelion-sol"],
      wildriftfire: ["aurelion-sol"],
      riftgg: ["aurelion-sol"],
      legacyLocal: ["aurelionsol"],
      cn: ["aurelionsol"],
    },
  },
  {
    canonical: "jarvan-iv",
    legacyLocal: "jarvaniv",
    sources: {
      riot: ["jarvan-iv"],
      wildriftfire: ["jarvan-iv"],
      riftgg: ["jarvan-iv"],
      legacyLocal: ["jarvaniv"],
      cn: ["jarvaniv"],
    },
  },
  {
    canonical: "lee-sin",
    legacyLocal: "leesin",
    sources: {
      riot: ["lee-sin"],
      wildriftfire: ["lee-sin"],
      riftgg: ["lee-sin"],
      legacyLocal: ["leesin"],
      cn: ["leesin"],
    },
  },
  {
    canonical: "dr-mundo",
    legacyLocal: "drmundo",
    sources: {
      riot: ["dr-mundo"],
      wildriftfire: ["dr-mundo"],
      riftgg: ["dr-mundo"],
      legacyLocal: ["drmundo"],
      cn: ["drmundo"],
    },
  },
  {
    canonical: "miss-fortune",
    legacyLocal: "missfortune",
    sources: {
      riot: ["miss-fortune"],
      wildriftfire: ["miss-fortune"],
      riftgg: ["miss-fortune"],
      legacyLocal: ["missfortune"],
      cn: ["missfortune"],
    },
  },
  {
    canonical: "twisted-fate",
    legacyLocal: "twistedfate",
    sources: {
      riot: ["twisted-fate"],
      wildriftfire: ["twisted-fate"],
      riftgg: ["twisted-fate"],
      legacyLocal: ["twistedfate"],
      cn: ["twistedfate"],
    },
  },
  {
    canonical: "master-yi",
    legacyLocal: "masteryi",
    sources: {
      riot: ["master-yi"],
      wildriftfire: ["master-yi"],
      riftgg: ["master-yi"],
      legacyLocal: ["masteryi"],
      cn: ["masteryi"],
    },
  },
];

const SOURCE_KEYS = ["riot", "wildriftfire", "riftgg", "legacyLocal", "cn"];

function normalizeSlug(value = "") {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

const aliasRecordByCanonical = new Map();
const canonicalByAlias = new Map();
const sourceAliasesByCanonical = new Map();

for (const rule of CHAMPION_SLUG_RULES) {
  const canonical = normalizeSlug(rule.canonical);
  const legacyLocal = normalizeSlug(rule.legacyLocal || canonical);
  const sourceAliases = {};

  for (const sourceKey of SOURCE_KEYS) {
    sourceAliases[sourceKey] = unique(
      (rule.sources?.[sourceKey] || []).map((value) => normalizeSlug(value)),
    );
  }

  const aliases = unique([
    canonical,
    legacyLocal,
    ...SOURCE_KEYS.flatMap((sourceKey) => sourceAliases[sourceKey]),
  ]);

  aliasRecordByCanonical.set(canonical, {
    canonical,
    legacyLocal,
    aliases,
  });
  sourceAliasesByCanonical.set(canonical, sourceAliases);

  for (const alias of aliases) {
    canonicalByAlias.set(alias, canonical);
  }
}

export function toCanonicalChampionSlug(source, sourceSlug) {
  const normalized = normalizeSlug(sourceSlug);
  if (!normalized) return null;
  return canonicalByAlias.get(normalized) || normalized;
}

export function toLegacyLocalChampionSlug(slug) {
  const canonical = toCanonicalChampionSlug("any", slug);
  if (!canonical) return null;
  return aliasRecordByCanonical.get(canonical)?.legacyLocal || canonical;
}

export function getChampionSlugAliases(slug) {
  const canonical = toCanonicalChampionSlug("any", slug);
  if (!canonical) return [];
  return aliasRecordByCanonical.get(canonical)?.aliases.slice() || [canonical];
}

export function getSourceChampionSlugCandidates(slug, source) {
  const canonical = toCanonicalChampionSlug("any", slug);
  if (!canonical) return [];

  const normalizedSource = String(source || "").trim();
  const sourceAliases = sourceAliasesByCanonical.get(canonical) || {};
  const preferred = unique(sourceAliases[normalizedSource] || []);

  return unique([
    ...preferred,
    canonical,
    aliasRecordByCanonical.get(canonical)?.legacyLocal || canonical,
  ]);
}

export function getChampionSlugRecord(slug) {
  const canonical = toCanonicalChampionSlug("any", slug);
  if (!canonical) return null;

  return {
    canonical,
    legacyLocal: toLegacyLocalChampionSlug(canonical),
    aliases: getChampionSlugAliases(canonical),
  };
}
