// No retained source confirms when a CN client actually applied these patches.
// Planned maintenance windows and article publication dates are not effective dates.
const PATCH_EFFECTIVE_DATES = {};

export function getPatchEffectiveDateMetadata(version) {
  const record = PATCH_EFFECTIVE_DATES[String(version || "").toLowerCase()];
  return {
    effectiveDate: record?.date || null,
    effectiveRegion: record?.region || null,
    effectiveDateSourceUrl: record?.sourceUrl || null,
  };
}
