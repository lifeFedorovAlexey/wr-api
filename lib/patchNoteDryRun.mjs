function identityKey(row) {
  if (row.entitySlug) return `slug:${row.entitySlug}`;
  return `name:${String(row.entityName || "").trim().toLocaleLowerCase()}`;
}

/** Build a compact, deterministic summary for a no-write patch-note import. */
export function buildPatchDryRunReport({ patchVersion, locale, sourceAction, contentHash, rows }) {
  const uniqueEntities = new Map();
  const rowCounts = {};
  const unresolvedIdentities = [];
  const systemRowsWithoutSlug = [];

  for (const row of rows || []) {
    const kind = row.entityKind || "system";
    const key = `${kind}:${identityKey(row)}`;
    rowCounts[kind] = (rowCounts[kind] || 0) + 1;
    if (!uniqueEntities.has(kind)) uniqueEntities.set(kind, new Set());
    uniqueEntities.get(kind).add(key);

    if (kind === "system") {
      if (!row.entitySlug) systemRowsWithoutSlug.push(row.entityName || row.sectionName || "(unnamed system change)");
    } else if (!row.entitySlug) {
      unresolvedIdentities.push({
        entityKind: kind,
        entityName: row.entityName || null,
        sectionName: row.sectionName || null,
      });
    }
  }

  return {
    patchVersion,
    locale,
    sourceAction,
    contentHash: contentHash || null,
    rowCounts,
    entityCounts: Object.fromEntries([...uniqueEntities].map(([kind, entities]) => [kind, entities.size])),
    unresolvedIdentities,
    systemRowsWithoutSlug,
  };
}
