import { createHash } from "node:crypto";
import { resolveChampionLocalizedName } from "./championLocalization.mjs";
import { getChampionSlugAliases, toCanonicalChampionSlug } from "./championSlug.mjs";
import { applyPatchDataSnapshotCorrections } from "./patchDataSnapshotCorrections.mjs";
import { comparePatchVersions, isValidPatchVersion } from "./patchVersion.mjs";

export const CHAMPION_BASE_STATS_DATASET = "champion-base-stats";
export const HUB_GAME_CHAMPION_STATS_SOURCE = "hub-game-champion-stats-baseline";

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stateHash(state) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function canonicalStateHash(state) {
  return createHash("sha256").update(stableJson(state)).digest("hex");
}

const BASE_STAT_FIELDS = [
  "health",
  "mana",
  "attack",
  "armor",
  "armorDamageReductionPercent",
  "magicResist",
  "magicDamageReductionPercent",
  "movementSpeed",
];
const RATING_FIELDS = ["damage", "survive", "utility", "difficulty"];
const GROWTH_FIELDS = ["health", "mana", "attack", "armor", "magicResist"];
const LEVEL_COUNT = 15;

function snapshotScope(snapshot) {
  return snapshot.state?.snapshotScope
    || snapshot.state?.source?.snapshotScope
    || (snapshot.sourceKind === HUB_GAME_CHAMPION_STATS_SOURCE ? "current-baseline" : "unclassified");
}

function reconstructionStatus(snapshot) {
  return snapshot.state?.historicalReconstruction
    || snapshot.state?.source?.historicalReconstruction
    || (snapshotScope(snapshot) === "current-baseline" ? "not-performed" : "unclassified");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validPatchVersion(value) {
  return isValidPatchVersion(value);
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasCompleteBaseStats(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  if (Object.keys(stats).length !== BASE_STAT_FIELDS.length
    || BASE_STAT_FIELDS.some((field) => !Object.hasOwn(stats, field))) return false;
  return !BASE_STAT_FIELDS.some((field) => field === "mana"
    ? stats[field] !== null && !isNonNegativeNumber(stats[field])
    : !isNonNegativeNumber(stats[field]));
}

function hasValidRatings(ratings) {
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)
    || Object.keys(ratings).length !== RATING_FIELDS.length
    || RATING_FIELDS.some((field) => !Object.hasOwn(ratings, field))) return false;
  return RATING_FIELDS.every((field) => {
    const rating = ratings[field];
    return rating && typeof rating === "object"
      && Number.isSafeInteger(rating.value)
      && Number.isSafeInteger(rating.max)
      && rating.max > 0
      && rating.value >= 0
      && rating.value <= rating.max;
  });
}

function hasValidGrowth(growth) {
  return Boolean(growth && typeof growth === "object" && !Array.isArray(growth)
    && Object.keys(growth).length === GROWTH_FIELDS.length
    && GROWTH_FIELDS.every((field) => Object.hasOwn(growth, field) && isNonNegativeNumber(growth[field])));
}

function hasValidLevelCurve(curve) {
  return Array.isArray(curve) && curve.length === LEVEL_COUNT && curve[0] === 0
    && curve.every((value) => isNonNegativeNumber(value));
}

function hasValidLanes(lanes) {
  return Array.isArray(lanes) && lanes.length > 0
    && lanes.every((lane) => typeof lane === "string" && lane.trim())
    && new Set(lanes).size === lanes.length;
}

function hasCompleteCurrentProgression(snapshot) {
  return hasValidGrowth(snapshot.state?.growthPerLevel)
    && hasValidLevelCurve(snapshot.state?.levelCurve)
    && hasValidLanes(snapshot.state?.lanes);
}

function roundToDisplayPrecision(value) {
  return Number(value.toFixed(1));
}

function damageReductionPercent(value) {
  return Math.round((value / (value + 100)) * 100);
}

function statsByLevel(state, levelCurve) {
  if (!hasValidGrowth(state.growthPerLevel) || !hasValidLevelCurve(levelCurve)) return null;
  let cumulativeCurve = 0;
  return levelCurve.map((curveValue, index) => {
    if (index > 0) cumulativeCurve += curveValue;
    if (index === 0) return state.statsAtLevel1;
    const stats = {
      health: roundToDisplayPrecision(state.statsAtLevel1.health + state.growthPerLevel.health * cumulativeCurve),
      mana: state.statsAtLevel1.mana === null
        ? null
        : roundToDisplayPrecision(state.statsAtLevel1.mana + state.growthPerLevel.mana * cumulativeCurve),
      attack: roundToDisplayPrecision(state.statsAtLevel1.attack + state.growthPerLevel.attack * cumulativeCurve),
      armor: roundToDisplayPrecision(state.statsAtLevel1.armor + state.growthPerLevel.armor * cumulativeCurve),
      magicResist: roundToDisplayPrecision(state.statsAtLevel1.magicResist + state.growthPerLevel.magicResist * cumulativeCurve),
      movementSpeed: state.statsAtLevel1.movementSpeed,
    };
    return {
      ...stats,
      armorDamageReductionPercent: damageReductionPercent(stats.armor),
      magicDamageReductionPercent: damageReductionPercent(stats.magicResist),
    };
  });
}

function hasCompleteChampionState(snapshot) {
  const state = snapshot.state;
  return Boolean(state && typeof state === "object" && !Array.isArray(state)
    && typeof state.name === "string" && state.name.trim()
    && typeof state.hubSlug === "string" && state.hubSlug.trim()
    && hasCompleteBaseStats(state.statsAtLevel1)
    && hasValidRatings(state.ratings));
}

function metadataKey(snapshot) {
  return stableJson([
    snapshot.patchVersion ?? null,
    snapshot.dataset ?? null,
    snapshot.entityKind ?? null,
    snapshot.sourceKind ?? null,
    snapshot.sourceUrl ?? null,
    snapshot.sourcePatchVersion ?? null,
    snapshot.sourceUpdatedAt ?? null,
    snapshot.verificationStatus ?? null,
    snapshot.sourceEvidence ?? null,
  ]);
}

function hasRequiredSnapshotMetadata(snapshot) {
  return validPatchVersion(snapshot.patchVersion)
    && snapshot.dataset === CHAMPION_BASE_STATS_DATASET
    && snapshot.entityKind === "champion"
    && typeof snapshot.sourceKind === "string" && Boolean(snapshot.sourceKind.trim())
    && typeof snapshot.sourceUrl === "string" && Boolean(snapshot.sourceUrl.trim())
    && validPatchVersion(snapshot.sourcePatchVersion)
    && typeof snapshot.sourceUpdatedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.sourceUpdatedAt)
    && Array.isArray(snapshot.sourceEvidence) && snapshot.sourceEvidence.length > 0;
}

function hasAlignedSnapshotRows(rows) {
  const first = rows[0];
  if (rows.some((row) => metadataKey(row) !== metadataKey(first)
    || row.verificationStatus !== "verified"
    || typeof row.contentHash !== "string" || !/^[a-f\d]{64}$/i.test(row.contentHash)
    || typeof row.entitySlug !== "string" || !row.entitySlug.trim()
    || !hasCompleteChampionState(row))) return false;
  if (new Set(rows.map((row) => row.entitySlug)).size !== rows.length) return false;
  return rows.every((row) => {
    const source = row.state.source;
    return source && source.sourceKind === first.sourceKind
      && source.sourceUrl === first.sourceUrl
      && source.patchVersion === first.patchVersion
      && source.sourcePatchVersion === first.sourcePatchVersion
      && source.sourceUpdatedAt === first.sourceUpdatedAt;
  });
}

function hasValidCurrentBaselineEvidence(rows) {
  const first = rows[0];
  if (first.sourceKind !== HUB_GAME_CHAMPION_STATS_SOURCE
    || rows.some((row) => snapshotScope(row) !== "current-baseline"
      || reconstructionStatus(row) !== "not-performed")) return false;
  const evidence = first.sourceEvidence[0];
  let sourceUrl;
  try {
    sourceUrl = new URL(first.sourceUrl);
  } catch {
    return false;
  }
  return first.sourceEvidence.length === 1
    && evidence?.kind === HUB_GAME_CHAMPION_STATS_SOURCE
    && evidence.role === "champion-stats"
    && evidence.url === first.sourceUrl
    && evidence.sourcePatchVersion === first.sourcePatchVersion
    && evidence.sourceUpdatedAt === first.sourceUpdatedAt
    && evidence.globalPatchThrough === first.patchVersion
    && evidence.progressionFormula === "base + growthPerLevel * sum(levelCurve[0..level-1])"
    && hasValidLevelCurve(evidence.levelCurve)
    && Number.isSafeInteger(evidence.listedChampionCount)
    && evidence.listedChampionCount === rows.length
    && first.state.source.patchVersion === first.patchVersion
    && sourceUrl.protocol === "https:"
    && ["hub-game.com", "www.hub-game.com"].includes(sourceUrl.hostname)
    && sourceUrl.pathname.replace(/\/$/, "") === "/wildrift/en/champions/stats"
    && rows.every((row) => hasCompleteCurrentProgression(row)
      && stableJson(row.state.levelCurve) === stableJson(evidence.levelCurve));
}

function isCompleteSnapshotGroup(rows, { currentBaseline = false } = {}) {
  if (!Array.isArray(rows) || rows.length === 0 || !hasRequiredSnapshotMetadata(rows[0])) return false;
  if (!hasAlignedSnapshotRows(rows)) return false;
  return !currentBaseline || hasValidCurrentBaselineEvidence(rows);
}

function getGlobalPatchThrough(snapshot) {
  const evidence = Array.isArray(snapshot.sourceEvidence) ? snapshot.sourceEvidence[0] : null;
  return evidence?.globalPatchThrough || snapshot.state?.source?.patchVersion || snapshot.patchVersion;
}

function candidateGroupKey(snapshot) {
  return stableJson([
    snapshot.patchVersion ?? null,
    snapshot.sourceKind ?? null,
    snapshot.sourceUrl ?? null,
    snapshot.sourcePatchVersion ?? null,
    snapshot.sourceUpdatedAt ?? null,
    snapshot.sourceEvidence ?? null,
  ]);
}

function rankForGroup(rows) {
  const first = rows[0];
  return {
    globalPatchThrough: getGlobalPatchThrough(first),
    sourceUpdatedAt: first.sourceUpdatedAt || "",
  };
}

function collectGroups(rows, predicate) {
  const groups = new Map();
  for (const row of rows.filter(predicate)) {
    const key = candidateGroupKey(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function chooseLatestCurrentBaseline(snapshots) {
  const groups = collectGroups(snapshots, (row) => row.sourceKind === HUB_GAME_CHAMPION_STATS_SOURCE
    || snapshotScope(row) === "current-baseline");
  const validGroups = groups.filter((group) => isCompleteSnapshotGroup(group, { currentBaseline: true }));
  const ranked = validGroups.map((rows) => ({ rows, ...rankForGroup(rows) }))
    .filter((group) => validPatchVersion(group.globalPatchThrough))
    .sort((left, right) => comparePatchVersions(right.globalPatchThrough, left.globalPatchThrough)
      || right.sourceUpdatedAt.localeCompare(left.sourceUpdatedAt));
  if (ranked.length === 0) return null;

  const best = ranked[0];
  const tiedGroups = groups.filter((rows) => {
    const rank = rankForGroup(rows);
    return rank.globalPatchThrough === best.globalPatchThrough && rank.sourceUpdatedAt === best.sourceUpdatedAt;
  });
  if (tiedGroups.length !== 1) return null;
  return best.rows;
}

function choosePatchExactHistorical(snapshots, patchVersion) {
  const groups = collectGroups(snapshots, (row) => row.patchVersion === patchVersion
    && ["historical", "patch-exact"].includes(snapshotScope(row)));
  if (groups.length !== 1 || !isCompleteSnapshotGroup(groups[0])) return null;
  return groups[0];
}

/** Convert Hub's current champion table into rows at its explicitly stated global patch. */
export function buildPatchChampionStatSnapshotRows(parsed) {
  if (!parsed || parsed.baselineKind !== "current-global-champion-stats") {
    throw new TypeError("A current Hub global champion stats baseline is required");
  }
  const patchVersion = requiredText(parsed.globalPatchThrough, "globalPatchThrough");
  const sourceKind = requiredText(parsed.sourceKind, "sourceKind");
  const sourceUrl = requiredText(parsed.sourceUrl, "sourceUrl");
  const sourcePatchVersion = requiredText(parsed.chinaLibraryPatch, "chinaLibraryPatch");
  const sourceUpdatedAt = requiredText(parsed.chinaLibraryAsOf, "chinaLibraryAsOf");
  const sourceEvidence = [{
    kind: sourceKind,
    role: "champion-stats",
    url: sourceUrl,
    sourcePatchVersion,
    sourceUpdatedAt,
    globalPatchThrough: patchVersion,
    listedChampionCount: parsed.count,
    levelCurve: parsed.levelCurve,
    progressionFormula: "base + growthPerLevel * sum(levelCurve[0..level-1])",
  }];

  if (!hasValidLevelCurve(parsed.levelCurve)) {
    throw new Error(`Hub champion baseline must include its ${LEVEL_COUNT}-level growth curve`);
  }

  if (!Array.isArray(parsed.champions) || parsed.champions.length !== parsed.count || parsed.count < 1) {
    throw new Error("Hub champion baseline has an invalid champion roster");
  }

  const slugs = new Set();
  return parsed.champions.map((champion) => {
    const entitySlug = requiredText(champion.slug, "champion.slug");
    if (slugs.has(entitySlug)) throw new Error(`Duplicate champion slug in Hub baseline: ${entitySlug}`);
    slugs.add(entitySlug);
    const name = requiredText(champion.name, `champion ${entitySlug} name`);
    const hubSlug = requiredText(champion.hubSlug, `champion ${entitySlug} Hub slug`);
    if (!champion.statsAtLevel1 || typeof champion.statsAtLevel1 !== "object" || !champion.ratings || typeof champion.ratings !== "object") {
      throw new Error(`Champion ${entitySlug} is missing level-1 stats or ratings`);
    }

    const state = {
      name,
      hubSlug,
      statsAtLevel1: champion.statsAtLevel1,
      growthPerLevel: champion.growthPerLevel,
      levelCurve: parsed.levelCurve,
      lanes: champion.lanes,
      ratings: champion.ratings,
      source: {
        sourceKind,
        sourceUrl,
        patchVersion,
        sourcePatchVersion,
        sourceUpdatedAt,
      },
    };
    return {
      patchVersion,
      dataset: CHAMPION_BASE_STATS_DATASET,
      entityKind: "champion",
      entitySlug,
      state,
      sourceKind,
      sourceUrl,
      sourcePatchVersion,
      sourceUpdatedAt,
      verificationStatus: "verified",
      sourceEvidence,
      contentHash: stateHash(state),
    };
  });
}

/** Refuse to mutate or partially extend a patch's already-persisted roster. */
export function assertImmutablePatchSnapshot(existingRows, incomingRows, label = "champion") {
  if (!Array.isArray(existingRows) || !Array.isArray(incomingRows) || incomingRows.length === 0) {
    throw new TypeError("Existing rows must be an array and incoming snapshot rows must be non-empty");
  }
  if (existingRows.length === 0) return { unchanged: 0 };

  const incomingBySlug = new Map(incomingRows.map((row) => [row.entitySlug, row]));
  const existingBySlug = new Map(existingRows.map((row) => [
    row.entitySlug ?? row.entity_slug,
    row,
  ]));
  const missingFromIncoming = [...existingBySlug.keys()].filter((slug) => !incomingBySlug.has(slug));
  const newInIncoming = [...incomingBySlug.keys()].filter((slug) => !existingBySlug.has(slug));
  const changed = [...existingBySlug]
    .filter(([slug, existing]) => {
      const incoming = incomingBySlug.get(slug);
      if (!incoming) return false;
      if (existing.state && typeof existing.state === "object" && incoming.state && typeof incoming.state === "object") {
        const existingHash = existing.contentHash ?? existing.content_hash;
        const stateMatches = stableJson(existing.state) === stableJson(incoming.state);
        const contentHashMatches = typeof existingHash === "string"
          && [incoming.contentHash, canonicalStateHash(existing.state)].includes(existingHash);
        return !stateMatches
          || !contentHashMatches
          || existing.patchVersion !== incoming.patchVersion
          || existing.dataset !== incoming.dataset
          || existing.entityKind !== incoming.entityKind
          || existing.sourceKind !== incoming.sourceKind
          || existing.sourceUrl !== incoming.sourceUrl
          || (existing.sourcePatchVersion ?? null) !== (incoming.sourcePatchVersion ?? null)
          || existing.sourceUpdatedAt !== incoming.sourceUpdatedAt
          || existing.verificationStatus !== incoming.verificationStatus
          || stableJson(existing.sourceEvidence) !== stableJson(incoming.sourceEvidence);
      }
      return (existing.contentHash ?? existing.content_hash) !== incoming.contentHash;
    })
    .map(([slug]) => slug);
  if (missingFromIncoming.length || newInIncoming.length || changed.length) {
    const details = [
      missingFromIncoming.length && `missing from source: ${missingFromIncoming.join(", ")}`,
      newInIncoming.length && `new source rows: ${newInIncoming.join(", ")}`,
      changed.length && `changed values: ${changed.join(", ")}`,
    ].filter(Boolean).join("; ");
    throw new Error(`Refusing to mutate immutable ${label} snapshot: ${details}`);
  }
  return { unchanged: existingRows.length };
}

function buildChampionCatalogAliases(championRows) {
  const catalogByHubSlug = new Map();
  for (const champion of championRows || []) {
    const isCanonicalSlug = toCanonicalChampionSlug("any", champion.slug) === champion.slug;
    for (const alias of getChampionSlugAliases(champion.slug)) {
      const current = catalogByHubSlug.get(alias);
      const currentIsCanonical = current
        && toCanonicalChampionSlug("any", current.slug) === current.slug;
      if (!current || isCanonicalSlug || !currentIsCanonical) catalogByHubSlug.set(alias, champion);
    }
  }
  return catalogByHubSlug;
}

function projectPublicChampionStats(selectedSnapshots, championRows, patchVersion, locale) {
  const catalogByHubSlug = buildChampionCatalogAliases(championRows);
  const localeKey = String(locale || "ru-ru").trim().toLowerCase().replaceAll("-", "_");
  const snapshotScopes = new Set(selectedSnapshots.map(snapshotScope));
  const reconstructionStatuses = new Set(selectedSnapshots.map(reconstructionStatus));
  const firstSnapshot = selectedSnapshots[0];
  const firstStateSource = firstSnapshot.state?.source || {};
  return {
    patchVersion,
    snapshotScope: snapshotScopes.size === 1 ? [...snapshotScopes][0] : "mixed",
    historicalReconstruction: reconstructionStatuses.size === 1 ? [...reconstructionStatuses][0] : "mixed",
    source: {
      kind: firstSnapshot.sourceKind,
      url: firstSnapshot.sourceUrl,
      sourcePatchVersion: firstSnapshot.sourcePatchVersion,
      sourceUpdatedAt: firstSnapshot.sourceUpdatedAt,
      declaredBase: firstSnapshot.sourceKind === HUB_GAME_CHAMPION_STATS_SOURCE && firstStateSource.sourcePatchVersion
        ? "Tencent China champion library"
        : "unclassified",
      chinaLibraryPatch: firstStateSource.sourcePatchVersion || null,
      chinaLibraryAsOf: firstStateSource.sourceUpdatedAt || null,
      globalPatchThrough: firstStateSource.patchVersion || null,
      snapshotPatchVersion: firstSnapshot.patchVersion,
      listedChampionCount: firstSnapshot.sourceEvidence?.[0]?.listedChampionCount ?? null,
    },
    count: selectedSnapshots.length,
    levelCurve: hasValidLevelCurve(firstSnapshot.state?.levelCurve) ? firstSnapshot.state.levelCurve : null,
    verificationStatus: selectedSnapshots.every((snapshot) => snapshot.verificationStatus === "verified")
      ? "verified"
      : "partial",
    champions: selectedSnapshots.map((snapshot) => ({
      slug: snapshot.entitySlug,
      name: resolveChampionLocalizedName({
        slug: snapshot.entitySlug,
        lang: localeKey,
        nameLocalizations: catalogByHubSlug.get(snapshot.entitySlug)?.nameLocalizations || {},
        fallbackName: catalogByHubSlug.get(snapshot.entitySlug)?.name,
      }) || snapshot.state.name,
      statsAtLevel1: snapshot.state.statsAtLevel1,
      growthPerLevel: snapshot.state.growthPerLevel || null,
      lanes: snapshot.state.lanes || null,
      statsByLevel: statsByLevel(snapshot.state, snapshot.state.levelCurve),
      ratings: snapshot.state.ratings,
      snapshotScope: snapshotScope(snapshot),
      historicalReconstruction: reconstructionStatus(snapshot),
      verificationStatus: snapshot.verificationStatus,
    })),
  };
}

/** Project verified patch-exact rows when present, otherwise the latest verified current baseline. */
export function buildPublicChampionStats(snapshots, championRows, patchVersion, locale = "ru-ru", corrections = []) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  if (!Array.isArray(corrections)) throw new TypeError("Champion snapshot corrections must be an array");
  const effectiveSnapshots = applyPatchDataSnapshotCorrections(
    snapshots.filter((row) => row.dataset === CHAMPION_BASE_STATS_DATASET),
    corrections.filter((row) => row.dataset === CHAMPION_BASE_STATS_DATASET),
  );
  const selectedSnapshots = choosePatchExactHistorical(effectiveSnapshots, patchVersion)
    || chooseLatestCurrentBaseline(effectiveSnapshots);
  return selectedSnapshots
    ? projectPublicChampionStats(selectedSnapshots, championRows, patchVersion, locale)
    : null;
}
