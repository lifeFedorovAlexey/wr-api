function normalizeItemIdentity(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Link localized patch changes to current Hub item rows without changing historical entity IDs. */
export function linkPatchItemsToHubBaseline(changes, englishChanges, hubItems) {
  if (!Array.isArray(changes) || !Array.isArray(hubItems) || hubItems.length === 0) return changes;

  const hubItemsBySlug = new Map();
  const hubItemsByName = new Map();
  for (const item of hubItems) {
    const slugKey = normalizeItemIdentity(item?.slug);
    if (slugKey) hubItemsBySlug.set(slugKey, item);
    const nameKey = normalizeItemIdentity(item?.name);
    if (!nameKey) continue;
    if (!hubItemsByName.has(nameKey)) hubItemsByName.set(nameKey, new Set());
    hubItemsByName.get(nameKey).add(item);
  }

  const englishNamesBySlug = new Map();
  const englishRowsByOrdinal = new Map();
  for (const change of Array.isArray(englishChanges) ? englishChanges : []) {
    if (change?.entityKind !== "item") continue;
    const slugKey = normalizeItemIdentity(change.entitySlug);
    if (slugKey && change.entityName) {
      if (!englishNamesBySlug.has(slugKey)) englishNamesBySlug.set(slugKey, new Set());
      englishNamesBySlug.get(slugKey).add(change.entityName);
    }
    if (Number.isInteger(change.ordinal)) {
      if (!englishRowsByOrdinal.has(change.ordinal)) englishRowsByOrdinal.set(change.ordinal, []);
      englishRowsByOrdinal.get(change.ordinal).push(change);
    }
  }

  return changes.map((change) => {
    if (change?.entityKind !== "item") return change;
    const slugKey = normalizeItemIdentity(change.entitySlug);
    const exact = slugKey ? hubItemsBySlug.get(slugKey) : null;
    if (exact) return { ...change, baselineItemSlug: exact.slug };

    const candidateNames = new Set([
      change.entityName,
      ...(englishNamesBySlug.get(slugKey) || []),
    ].map(normalizeItemIdentity).filter(Boolean));
    const matches = new Set();
    for (const name of candidateNames) {
      for (const item of hubItemsByName.get(name) || []) matches.add(item);
    }
    if (matches.size === 1) return { ...change, baselineItemSlug: matches.values().next().value.slug };
    if (matches.size > 1 || !Number.isInteger(change.ordinal)) return change;

    // Localized Riot articles can assign different slugs to the same item. Use the
    // English row at the same parser position only when both locales preserve the
    // same changed values and change type, so an unrelated row cannot be linked.
    const signature = itemChangeValueSignature(change);
    if (!signature) return change;
    const alignedMatches = new Set();
    for (const englishChange of englishRowsByOrdinal.get(change.ordinal) || []) {
      if (englishChange.changeType !== change.changeType
        || itemChangeValueSignature(englishChange) !== signature) continue;
      const englishSlugKey = normalizeItemIdentity(englishChange.entitySlug);
      const englishItem = englishSlugKey ? hubItemsBySlug.get(englishSlugKey) : null;
      if (englishItem) alignedMatches.add(englishItem);
      for (const name of [englishChange.entityName].map(normalizeItemIdentity).filter(Boolean)) {
        for (const item of hubItemsByName.get(name) || []) alignedMatches.add(item);
      }
    }
    if (alignedMatches.size !== 1) return change;
    return { ...change, baselineItemSlug: alignedMatches.values().next().value.slug };
  });
}

function itemChangeValueSignature(change) {
  const values = (change?.details || []).flatMap((detail) => [detail?.before, detail?.after])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return values.length ? JSON.stringify(values) : null;
}
