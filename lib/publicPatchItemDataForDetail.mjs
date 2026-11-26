import { linkPatchItemsToHubBaseline } from "./patchItemBaselineLinks.mjs";
import { buildPublicCurrentItemBaseline, buildPublicPatchItemData } from "./publicPatchItemSnapshots.mjs";

/** Build patch-exact item data plus an explicitly separate latest current baseline. */
export function buildPublicPatchItemDataForDetail({
  patchVersion,
  snapshots,
  corrections = [],
  changes = [],
  englishChanges = changes,
}) {
  if (typeof patchVersion !== "string" || !patchVersion.trim()) {
    throw new TypeError("patchVersion must be a non-empty string");
  }
  if (!Array.isArray(snapshots) || !Array.isArray(corrections)) {
    throw new TypeError("snapshots and corrections must be arrays");
  }

  const exactSnapshots = snapshots.filter((snapshot) => snapshot.patchVersion === patchVersion);
  const exactCorrections = corrections.filter((correction) => correction.patchVersion === patchVersion);
  const itemData = buildPublicPatchItemData(exactSnapshots, patchVersion, exactCorrections);
  const projectedBaseline = buildPublicCurrentItemBaseline(snapshots, corrections);
  const currentItemBaseline = projectedBaseline
    ? { ...projectedBaseline, requestedPatchVersion: patchVersion }
    : null;
  const linkedChanges = linkPatchItemsToHubBaseline(
    changes,
    englishChanges,
    currentItemBaseline?.items || [],
  );

  return { itemData, currentItemBaseline, changes: linkedChanges };
}
