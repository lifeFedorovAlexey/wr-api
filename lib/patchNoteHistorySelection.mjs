/**
 * Keep the complete Riot index by default. A limit is only applied when a
 * caller explicitly supplies PATCH_NOTES_MAX_HISTORY for a bounded run.
 */
export function selectPatchHistory(items, limitValue) {
  if (!Array.isArray(items)) throw new TypeError("Patch history index must be an array");

  if (limitValue === undefined || limitValue === null || String(limitValue).trim() === "") {
    return items;
  }

  const limit = typeof limitValue === "number" ? limitValue : Number(String(limitValue).trim());
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("PATCH_NOTES_MAX_HISTORY must be a positive safe integer when provided");
  }

  return items.slice(0, limit);
}
