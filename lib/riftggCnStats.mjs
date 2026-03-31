import { buildPublicIconPath } from "./championIcons.mjs";

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

function extractJsonValue(source, key) {
  const marker = `"${key}":`;
  const startIndex = source.indexOf(marker);
  if (startIndex < 0) return null;

  let cursor = startIndex + marker.length;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }

  const openingChar = source[cursor];
  if (openingChar !== "{" && openingChar !== "[") {
    return null;
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
      return source.slice(cursor, index + 1);
    }
  }

  return null;
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

function createBuildKey(entrySlugs) {
  return entrySlugs.join("|");
}

function toBuildRows(championSlug, rows, buildType, entryKey) {
  const normalizedRows = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const rank = normalizeKey(row?.rankLevel || "");
    const lane = normalizeKey(row?.lane || "");
    const dataDate = String(row?.dataDate || "").trim() || null;
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

  const statsRaw = extractJsonValue(decodedPayload, "stats");
  const itemsDictRaw = extractJsonValue(decodedPayload, "itemsDict");
  const runesDictRaw = extractJsonValue(decodedPayload, "runesDict");
  const spellsDictRaw = extractJsonValue(decodedPayload, "spellsDict");

  if (!statsRaw || !itemsDictRaw || !runesDictRaw || !spellsDictRaw) {
    throw new Error("RiftGG stats dictionaries are missing in payload");
  }

  return {
    stats: JSON.parse(statsRaw),
    itemsDict: JSON.parse(itemsDictRaw),
    runesDict: JSON.parse(runesDictRaw),
    spellsDict: JSON.parse(spellsDictRaw),
  };
}

export function normalizeRiftGgCnStats(championSlug, parsed) {
  const stats = parsed?.stats || {};
  const matchups = [];

  for (const row of Array.isArray(stats.matchups) ? stats.matchups : []) {
    const rank = normalizeKey(row?.rankLevel || "");
    const lane = normalizeKey(row?.lane || "");
    const dataDate = String(row?.dataDate || "").trim() || null;

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
  if (!matchupRows.length && !buildRows.length) {
    return null;
  }

  const opponentsBySlug = Object.fromEntries(
    opponentRows
      .filter((row) => row?.slug)
      .map((row) => [
        row.slug,
        {
          slug: row.slug,
          name: row.name,
          iconUrl: row.icon ? buildPublicIconPath(row.slug, row.icon) : null,
          roles: Array.isArray(row.roles) ? row.roles : [],
        },
      ]),
  );

  const groupedMatchups = groupByFilter(matchupRows).map((group) => {
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
    groupByFilter(buildRows.filter((row) => row.buildType === buildType)).map((group) => ({
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

  for (const row of [...matchupRows, ...buildRows]) {
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
