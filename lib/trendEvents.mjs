const LANE_ALIASES = {
  top: "top", solo: "top", baron: "top", "барон": "top", "топ": "top",
  jungle: "jungle", "лес": "jungle", mid: "mid", middle: "mid", "мид": "mid",
  adc: "adc", duo: "adc", dragon: "adc", "адк": "adc",
  support: "support", "поддержка": "support", "саппорт": "support",
};

export function validEventDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

// These are current guide recommendations, not historical build snapshots.
export function currentGuideRelations({ variants, sections, summary, lane }) {
  const matchingVariants = new Set(variants.filter((variant) => {
    const role = String(variant.lane || (variant.isDefault ? summary?.recommendedRole : "") || "").toLowerCase().trim();
    return LANE_ALIASES[role] === lane;
  }).map((variant) => variant.variantKey));
  const relations = new Map();
  for (const section of sections) {
    if (!matchingVariants.has(section.variantKey)) continue;
    const kind = section.sectionType === "itemBuild" && section.sectionKey === "core" ? "item"
      : section.sectionType === "spellsAndRunes" && section.sectionKey === "runes" ? "rune" : null;
    if (!kind) continue;
    for (const slug of section.entitySlugs || []) {
      relations.set(`${kind}:${slug}`, {
        kind: "current-guide", patch: summary?.patch || null,
        sourceUrl: summary?.sourceUrl || null,
      });
    }
  }
  return relations;
}

function compareVersions(a, b) {
  const parts = (value) => String(value).match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
  const left = parts(a); const right = parts(b);
  return Number(left[1]) - Number(right[1]) || Number(left[2]) - Number(right[2])
    || String(left[3]).localeCompare(String(right[3]));
}

function groupChanges(rows, slug, relations) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.entityKind}:${row.entitySlug}`;
    const direct = row.entityKind === "champion" && row.entitySlug === slug;
    if (!direct && !relations.has(key)) continue;
    // Prefer Russian per entity, but retain entities only parsed in English.
    const current = groups.get(key);
    if (current && current.locale === "ru-ru" && row.locale !== "ru-ru") continue;
    if (!current || (row.locale === "ru-ru" && current.locale !== "ru-ru")) {
      groups.set(key, {
        id: key, entityKind: row.entityKind, entitySlug: row.entitySlug,
        entityName: row.entityName, imageUrl: row.imageUrl, locale: row.locale,
        relation: direct ? null : relations.get(key), records: [],
      });
    }
    groups.get(key).records.push({
      changeType: row.changeType, changeName: row.changeName, details: row.details || [],
    });
  }
  return [...groups.values()].map((group) => {
    const types = [...new Set(group.records.map((row) => row.changeType))];
    // A mixed buff/nerf is an adjustment, never an invented net buff or rework.
    return { ...group, changeType: types.includes("rework") ? "rework" : types.length === 1 ? types[0] : "adjustment" };
  }).sort((a, b) => Number(b.entityKind === "champion") - Number(a.entityKind === "champion"));
}

export function buildTrendEvents({ patches, changes, slug, relations = new Map(), from, to, seasons = [] }) {
  const byVersion = new Map();
  for (const patch of patches) {
    const current = byVersion.get(patch.patchVersion);
    if (!current || patch.locale === "ru-ru") byVersion.set(patch.patchVersion, patch);
  }
  const ordered = [...byVersion.values()].sort((a, b) => compareVersions(a.patchVersion, b.patchVersion));
  const result = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const patch = ordered[index];
    const date = patch.effectiveDate;
    if (patch.effectiveRegion !== "CN" || !validEventDate(date) || date < from || date > to) continue;
    const next = ordered[index + 1];
    const nextDate = next?.effectiveRegion === "CN" && validEventDate(next.effectiveDate)
      && next.effectiveDate > date ? next.effectiveDate : null;
    const entities = groupChanges(changes.filter((row) => row.patchVersion === patch.patchVersion), slug, relations);
    if (!entities.length) continue;
    result.push({
      version: patch.patchVersion, date, nextDate,
      sourceUrl: patch.sourceUrl, dateSourceUrl: patch.effectiveDateSourceUrl,
      changes: entities,
    });
  }
  return {
    patches: result.sort((a, b) => a.date.localeCompare(b.date)),
    seasons: seasons.filter((season) => season.region === "CN" && validEventDate(season.date)
      && season.date >= from && season.date <= to),
  };
}
