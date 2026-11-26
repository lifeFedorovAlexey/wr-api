/** Keep patch-note changes and current reference snapshots separate in the detail API contract. */
export function buildPublicPatchDetailResponse({
  patch,
  changes,
  championStats = null,
  itemData = null,
  currentItemBaseline = null,
  runeData = null,
  summonerSpellData = null,
}) {
  if (!patch || typeof patch !== "object") throw new TypeError("patch must be a database patch-note row");
  if (!Array.isArray(changes)) throw new TypeError("changes must be an array");

  return {
    version: patch.patchVersion,
    locale: patch.locale,
    title: patch.title,
    description: patch.description,
    sourceUrl: patch.sourceUrl,
    publishedAt: patch.publishedAt,
    effectiveDate: patch.effectiveDate,
    effectiveRegion: patch.effectiveRegion,
    effectiveDateSourceUrl: patch.effectiveDateSourceUrl,
    imageUrl: patch.imageUrl,
    changes,
    championStats,
    itemData,
    currentItemBaseline,
    runeData,
    summonerSpellData,
  };
}
