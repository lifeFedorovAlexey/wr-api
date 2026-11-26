const COUNTED_CHANGE_TYPES = ["buff", "nerf", "adjustment"];

/** Count unique champions by change type and patch locale, independent of image availability. */
export function countPatchChampionChanges(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const changesByPatchLocale = new Map();
  for (const row of rows) {
    if (row.entityKind !== "champion" || row.scope?.type === "game-mode" || !COUNTED_CHANGE_TYPES.includes(row.changeType)) continue;
    const patchVersion = String(row.patchVersion ?? "").trim();
    const locale = String(row.locale ?? "").trim();
    const identity = String(row.entitySlug || row.entityName || "").trim().toLowerCase();
    if (!patchVersion || !locale || !identity) continue;

    const key = `${patchVersion}:${locale}`;
    let champions = changesByPatchLocale.get(key);
    if (!champions) {
      champions = new Map();
      changesByPatchLocale.set(key, champions);
    }
    let types = champions.get(identity);
    if (!types) {
      types = new Set();
      champions.set(identity, types);
    }
    types.add(row.changeType);
  }

  return new Map([...changesByPatchLocale].map(([key, champions]) => {
    const counts = { buff: 0, nerf: 0, adjustment: 0 };
    for (const types of champions.values()) {
      if (types.has("adjustment") || (types.has("buff") && types.has("nerf"))) {
        counts.adjustment += 1;
      } else if (types.has("buff")) {
        counts.buff += 1;
      } else if (types.has("nerf")) {
        counts.nerf += 1;
      }
    }
    return [key, counts];
  }));
}
