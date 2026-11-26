const NON_ENTITY_SECTION_LABELS = new Map([
  ["item:yordle item updates", "system"],
  ["item:returning items", "system"],
  ["spell:damage dealt", "system"],
  ["spell:damage received", "system"],
  ["spell:shield effect", "system"],
  ["spell:heal effect", "system"],
  ["item:sunburst", "system"],
  ["item:mirrored force", "system"],
]);

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

/** Correct old parser rows that persisted section/component labels as entities. */
export function normalizePatchChangeEntityClassification(row) {
  if (!row || typeof row !== "object") return row;
  const targetKind = NON_ENTITY_SECTION_LABELS.get(`${row.entityKind}:${normalizeLabel(row.entityName)}`);
  if (!targetKind) return row;
  return { ...row, entityKind: targetKind, entitySlug: null };
}
