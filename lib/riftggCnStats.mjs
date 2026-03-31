import { buildPublicIconPath } from "./championIcons.mjs";

const VALID_RIFT_RANKS = new Set([
  "diamond_plus",
  "master_plus",
  "challenger",
  "super_server",
]);

const VALID_RIFT_LANES = new Set(["top", "jungle", "mid", "adc", "support"]);

function normalizeKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/\+/g, "_plus")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s/.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeRiftRankKey(value = "") {
  return normalizeKey(value);
}

function normalizeRiftLaneKey(value = "") {
  const normalized = normalizeKey(value);
  if (normalized === "dragon" || normalized === "duo") return "adc";
  if (normalized === "baron" || normalized === "solo") return "top";
  return normalized;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function decodeFlightPayload(html = "") {
  const chunks = [];
  const pattern = /self\.__next_f\.push\(\[\d+,"([\s\S]*?)"\]\)/g;

  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(`"${match[1]}"`));
    } catch {}
  }

  return chunks.join("");
}

function extractJsonValues(source, key) {
  const marker = `"${key}":`;
  const values = [];
  let searchIndex = 0;

  while (searchIndex < source.length) {
    const startIndex = source.indexOf(marker, searchIndex);
    if (startIndex < 0) break;

    let cursor = startIndex + marker.length;
    while (cursor < source.length && /\s/.test(source[cursor])) {
      cursor += 1;
    }

    const openingChar = source[cursor];
    if (openingChar !== "{" && openingChar !== "[") {
      searchIndex = cursor + 1;
      continue;
    }

    const closingChar = openingChar === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = cursor; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === openingChar) depth += 1;
      if (char === closingChar) depth -= 1;

      if (depth === 0) {
        values.push(source.slice(cursor, index + 1));
        searchIndex = index + 1;
        break;
      }
    }
  }

  return values;
}

function parseJsonCandidates(source, key) {
  return extractJsonValues(source, key)
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractJsonObjectAfterMarker(source, marker) {
  const startIndex = source.indexOf(marker);
  if (startIndex < 0) return null;

  let cursor = startIndex + marker.length;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }

  if (source[cursor] !== "{") {
    return null;
  }

  return extractBalancedJsonSlice(source, cursor);
}

function extractBalancedJsonSlice(source, startIndex) {
  const openingChar = source[startIndex];
  const closingChar = openingChar === "{" ? "}" : openingChar === "[" ? "]" : null;
  if (!closingChar) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openingChar) depth += 1;
    if (char === closingChar) depth -= 1;

    if (depth === 0) {
      return source.slice(startIndex, index + 1);
    }
  }

  return null;
}

function extractCnStatsTabsPayload(source) {
  const componentMatch = source.match(/(?:^|\n)([A-Za-z0-9]+):I\[[^\n]*"CNStatsTabs"\]/);
  if (!componentMatch?.[1]) {
    return null;
  }

  const componentRef = `"$L${componentMatch[1]}",null,`;
  const payloadRaw = extractJsonObjectAfterMarker(source, componentRef);
  if (!payloadRaw) {
    return null;
  }

  try {
    return JSON.parse(payloadRaw);
  } catch {
    return null;
  }
}

function extractCompositeStatsPayloads(source) {
  const payloads = [];
  let searchIndex = 0;
  const statsMarker = `"stats":`;

  while (searchIndex < source.length) {
    const statsIndex = source.indexOf(statsMarker, searchIndex);
    if (statsIndex < 0) break;

    let objectStart = -1;
    for (let index = statsIndex; index >= 0; index -= 1) {
      if (source[index] === "{") {
        objectStart = index;
        break;
      }
      if (source[index] === "\n") break;
    }

    if (objectStart >= 0) {
      const objectRaw = extractBalancedJsonSlice(source, objectStart);
      if (objectRaw) {
        try {
          const parsed = JSON.parse(objectRaw);
          if (parsed && typeof parsed === "object" && parsed.stats) {
            payloads.push(parsed);
          }
          searchIndex = objectStart + objectRaw.length;
          continue;
        } catch {}
      }
    }

    searchIndex = statsIndex + statsMarker.length;
  }

  return payloads;
}

function normalizeDictionaryEntries(entries = {}, kind) {
  return Object.values(entries || {}).map((entry) => ({
    kind,
    slug: String(entry?.slug || "").trim(),
    name: String(entry?.name || "").trim(),
    rawPayload: entry,
  }));
}

function metricFields(metrics = {}) {
  return {
    winRate: toFiniteNumber(metrics?.winRate),
    pickRate: toFiniteNumber(metrics?.appearRate),
    winRateRank: Number.isInteger(metrics?.winRateRank)
      ? metrics.winRateRank
      : toFiniteNumber(metrics?.winRateRank),
    pickRateRank: Number.isInteger(metrics?.appearRateRank)
      ? metrics.appearRateRank
      : toFiniteNumber(metrics?.appearRateRank),
  };
}

function humanizeSlug(value = "") {
  return String(value || "")
    .trim()
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pickChampionDisplayName(row) {
  const names = row?.nameLocalizations || {};
  return names.ru_ru || names.en_us || row?.name || humanizeSlug(row?.slug || "");
}

function isValidRiftFilter(rank, lane) {
  return VALID_RIFT_RANKS.has(rank) && VALID_RIFT_LANES.has(lane);
}

function countUsableStatsEntries(stats = {}) {
  let total = 0;

  for (const row of Array.isArray(stats.matchups) ? stats.matchups : []) {
    const rank = normalizeRiftRankKey(row?.rankLevel || "");
    const lane = normalizeRiftLaneKey(row?.lane || "");
    if (!isValidRiftFilter(rank, lane)) continue;
    total += Array.isArray(row?.counters) ? row.counters.length : 0;
  }

  for (const collectionKey of ["core_items", "runes", "spells"]) {
    for (const row of Array.isArray(stats?.[collectionKey]) ? stats[collectionKey] : []) {
      const rank = normalizeRiftRankKey(row?.rankLevel || "");
      const lane = normalizeRiftLaneKey(row?.lane || "");
      if (!isValidRiftFilter(rank, lane)) continue;

      const entries = Array.isArray(row?.builds)
        ? row.builds
        : collectionKey === "spells" && Array.isArray(row?.spells)
          ? row.spells
          : [];
      total += entries.length;
    }
  }

  return total;
}

function pickBestStatsCandidate(candidates = []) {
  return candidates
    .filter(Boolean)
    .slice()
    .sort((left, right) => countUsableStatsEntries(right) - countUsableStatsEntries(left))[0] || null;
}

function pickBestCompositePayload(candidates = []) {
  return candidates
    .filter((candidate) => candidate?.stats)
    .slice()
    .sort((left, right) => countUsableStatsEntries(right.stats) - countUsableStatsEntries(left.stats))[0] || null;
}

function hasRequiredDictionaries(payload) {
  return Boolean(payload?.itemsDict && payload?.runesDict && payload?.spellsDict);
}

function createBuildKey(entrySlugs) {
  return entrySlugs.join("|");
}

function toBuildRows(championSlug, rows, buildType, entryKey) {
  const normalizedRows = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const rank = normalizeRiftRankKey(row?.rankLevel || "");
    const lane = normalizeRiftLaneKey(row?.lane || "");
    const dataDate = String(row?.dataDate || "").trim() || null;
    if (!isValidRiftFilter(rank, lane)) continue;
    const builds = Array.isArray(row?.builds)
      ? row.builds
      : buildType === "spells" && Array.isArray(row?.spells)
        ? row.spells
        : [];

    for (const build of builds) {
      const entrySlugs = (build?.[entryKey] || [])
        .map((entry) => String(entry?.slug || "").trim())
        .filter(Boolean);

      if (!rank || !lane || !entrySlugs.length) continue;

      normalizedRows.push({
        championSlug,
        rank,
        lane,
        dataDate,
        buildType,
        buildKey: createBuildKey(entrySlugs),
        entrySlugs,
        ...metricFields(build?.metrics),
        rawPayload: build,
      });
    }
  }

  return normalizedRows;
}

export function parseRiftGgCnStatsHtml(html = "") {
  const decodedPayload = decodeFlightPayload(html);
  if (!decodedPayload) {
    throw new Error("RiftGG payload not found in HTML");
  }

  const tabsPayload = extractCnStatsTabsPayload(decodedPayload);
  const tabsPayloadIsUsable =
    tabsPayload?.stats &&
    hasRequiredDictionaries(tabsPayload) &&
    countUsableStatsEntries(tabsPayload.stats) > 0;

  if (tabsPayloadIsUsable) {
    return {
      stats: tabsPayload.stats,
      itemsDict: tabsPayload.itemsDict,
      runesDict: tabsPayload.runesDict,
      spellsDict: tabsPayload.spellsDict,
    };
  }

  const compositePayload = pickBestCompositePayload(extractCompositeStatsPayloads(decodedPayload));
  const stats = compositePayload?.stats || pickBestStatsCandidate(parseJsonCandidates(decodedPayload, "stats"));
  const itemsDict = compositePayload?.itemsDict || parseJsonCandidates(decodedPayload, "itemsDict")[0] || null;
  const runesDict = compositePayload?.runesDict || parseJsonCandidates(decodedPayload, "runesDict")[0] || null;
  const spellsDict = compositePayload?.spellsDict || parseJsonCandidates(decodedPayload, "spellsDict")[0] || null;

  if (!stats || !itemsDict || !runesDict || !spellsDict) {
    throw new Error("RiftGG stats dictionaries are missing in payload");
  }

  return {
    stats,
    itemsDict,
    runesDict,
    spellsDict,
  };
}

export function normalizeRiftGgCnStats(championSlug, parsed) {
  const stats = parsed?.stats || {};
  const matchups = [];

  for (const row of Array.isArray(stats.matchups) ? stats.matchups : []) {
    const rank = normalizeRiftRankKey(row?.rankLevel || "");
    const lane = normalizeRiftLaneKey(row?.lane || "");
    const dataDate = String(row?.dataDate || "").trim() || null;
    if (!isValidRiftFilter(rank, lane)) continue;

    for (const counter of Array.isArray(row?.counters) ? row.counters : []) {
      const opponentSlug = String(counter?.heroSlug || "").trim();
      if (!rank || !lane || !opponentSlug) continue;

      matchups.push({
        championSlug,
        rank,
        lane,
        dataDate,
        opponentSlug,
        ...metricFields(counter?.metrics),
        rawPayload: counter,
      });
    }
  }

  return {
    matchups,
    builds: [
      ...toBuildRows(championSlug, stats.core_items, "coreItems", "items"),
      ...toBuildRows(championSlug, stats.runes, "runes", "runes"),
      ...toBuildRows(championSlug, stats.spells, "spells", "spells"),
    ],
    dictionaries: [
      ...normalizeDictionaryEntries(parsed?.itemsDict, "item"),
      ...normalizeDictionaryEntries(parsed?.runesDict, "rune"),
      ...normalizeDictionaryEntries(parsed?.spellsDict, "spell"),
    ],
  };
}

function groupByFilter(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const key = `${row.rank}::${row.lane}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        rank: row.rank,
        lane: row.lane,
        dataDate: row.dataDate || null,
        entries: [],
      });
    }

    const group = grouped.get(key);
    if (!group.dataDate && row.dataDate) {
      group.dataDate = row.dataDate;
    }
    group.entries.push(row);
  }

  return Array.from(grouped.values()).sort(
    (left, right) =>
      left.rank.localeCompare(right.rank) || left.lane.localeCompare(right.lane),
  );
}

function mapDictionaryRows(rows) {
  const mapped = {};

  for (const row of rows) {
    if (!row?.slug) continue;
    const rawPayload = row.rawPayload || {};

    mapped[row.slug] = {
      slug: row.slug,
      name: row.name || rawPayload.name || row.slug,
      ...rawPayload,
    };
  }

  return mapped;
}

export function buildRiftGgGuidePayload({
  matchupRows = [],
  buildRows = [],
  opponentRows = [],
  itemRows = [],
  runeRows = [],
  spellRows = [],
}) {
  const filteredMatchupRows = matchupRows.filter(
    (row) => VALID_RIFT_RANKS.has(row?.rank) && VALID_RIFT_LANES.has(row?.lane),
  );
  const filteredBuildRows = buildRows.filter(
    (row) => VALID_RIFT_RANKS.has(row?.rank) && VALID_RIFT_LANES.has(row?.lane),
  );

  if (!filteredMatchupRows.length && !filteredBuildRows.length) {
    return null;
  }

  const opponentsBySlug = Object.fromEntries(
    opponentRows
      .filter((row) => row?.slug)
      .map((row) => [
        row.slug,
        {
          slug: row.slug,
          name: pickChampionDisplayName(row),
          iconUrl: row.icon ? buildPublicIconPath(row.slug, row.icon) : null,
          roles: Array.isArray(row.roles) ? row.roles : [],
        },
      ]),
  );

  const groupedMatchups = groupByFilter(filteredMatchupRows).map((group) => {
    const entries = group.entries
      .slice()
      .sort((left, right) => {
        const winDelta = (right.winRate ?? -Infinity) - (left.winRate ?? -Infinity);
        if (winDelta !== 0) return winDelta;
        return (right.pickRate ?? -Infinity) - (left.pickRate ?? -Infinity);
      })
      .map((row) => ({
        opponentSlug: row.opponentSlug,
        opponent: opponentsBySlug[row.opponentSlug] || null,
        winRate: row.winRate,
        pickRate: row.pickRate,
        winRateRank: row.winRateRank,
        pickRateRank: row.pickRateRank,
      }));

    return {
      rank: group.rank,
      lane: group.lane,
      dataDate: group.dataDate,
      best: entries.slice(0, 5),
      worst: entries.slice().sort((left, right) => (left.winRate ?? Infinity) - (right.winRate ?? Infinity)).slice(0, 5),
      entries,
    };
  });

  const groupedBuilds = (buildType) =>
    groupByFilter(filteredBuildRows.filter((row) => row.buildType === buildType)).map((group) => ({
      rank: group.rank,
      lane: group.lane,
      dataDate: group.dataDate,
      entries: group.entries
        .slice()
        .sort((left, right) => {
          const winDelta = (right.winRate ?? -Infinity) - (left.winRate ?? -Infinity);
          if (winDelta !== 0) return winDelta;
          return (right.pickRate ?? -Infinity) - (left.pickRate ?? -Infinity);
        })
        .map((row) => ({
          entrySlugs: Array.isArray(row.entrySlugs) ? row.entrySlugs : [],
          winRate: row.winRate,
          pickRate: row.pickRate,
          winRateRank: row.winRateRank,
          pickRateRank: row.pickRateRank,
        })),
    }));

  const ranks = new Set();
  const lanes = new Set();

  for (const row of [...filteredMatchupRows, ...filteredBuildRows]) {
    if (row.rank) ranks.add(row.rank);
    if (row.lane) lanes.add(row.lane);
  }

  return {
    source: "riftgg",
    availableRanks: Array.from(ranks).sort(),
    availableLanes: Array.from(lanes).sort(),
    matchups: groupedMatchups,
    coreItems: groupedBuilds("coreItems"),
    runes: groupedBuilds("runes"),
    spells: groupedBuilds("spells"),
    dictionaries: {
      items: mapDictionaryRows(itemRows),
      runes: mapDictionaryRows(runeRows),
      spells: mapDictionaryRows(spellRows),
    },
  };
}
