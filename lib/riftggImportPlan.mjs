import {
  filterChampionsForPublicPool,
  isChampionInPublicPool,
  summarizeChampionPublicPool,
} from "./championPublicPool.mjs";

export function buildRiftGgImportPlan({ championRows, requestedSlugs = [] }) {
  const normalizedRequestedSlugs = requestedSlugs
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const requestedSlugSet = new Set(normalizedRequestedSlugs);
  const foundSlugSet = new Set(
    championRows.map((row) => String(row?.slug || "").trim()).filter(Boolean),
  );
  const publicChampionRows = filterChampionsForPublicPool(championRows);
  const poolSummary = summarizeChampionPublicPool(championRows);
  const slugs = publicChampionRows.map((row) => row.slug).filter(Boolean);
  const filteredOutCount = championRows.length - publicChampionRows.length;
  const missingRequestedSlugs = normalizedRequestedSlugs.filter((slug) => !foundSlugSet.has(slug));
  const excludedRequestedSlugs = championRows
    .filter((row) => requestedSlugSet.has(String(row?.slug || "").trim()))
    .filter((row) => !isChampionInPublicPool(row))
    .map((row) => String(row?.slug || "").trim());

  return {
    requestedSlugs: normalizedRequestedSlugs,
    championRows,
    publicChampionRows,
    slugs,
    poolSummary,
    filteredOutCount,
    missingRequestedSlugs,
    excludedRequestedSlugs,
  };
}

export function buildRiftGgImportReport({ plan, execution, itemAssetSummary }) {
  return {
    requested: plan.requestedSlugs.length || null,
    total: plan.slugs.length,
    uploaded: execution.uploaded.length,
    skipped: execution.skipped.length,
    failed: execution.failed.length,
    temporaryEnOnly: plan.poolSummary.temporaryEnOnly,
    excludedNonPublic: plan.filteredOutCount,
    missingRequestedSlugs: plan.missingRequestedSlugs,
    excludedRequestedSlugs: plan.excludedRequestedSlugs,
    itemAssets: itemAssetSummary,
  };
}

export function logRiftGgImportPlan(plan, { importConcurrency }) {
  console.log(
    `[riftgg-cn-stats] start: champions=${plan.slugs.length}${plan.requestedSlugs.length ? " (filtered)" : ""} concurrency=${importConcurrency}${plan.filteredOutCount > 0 ? ` excludedNonPublic=${plan.filteredOutCount}` : ""}${plan.poolSummary.temporaryEnOnly > 0 ? ` temporaryEnOnly=${plan.poolSummary.temporaryEnOnly}` : ""}`,
  );

  if (plan.poolSummary.temporaryEnOnly > 0) {
    console.warn(
      `[riftgg-cn-stats] temporary en-only Riot champions included in import: ${plan.poolSummary.temporaryEnOnlySlugs.join(", ")}`,
    );
  }

  if (plan.poolSummary.excluded > 0) {
    console.warn(
      `[riftgg-cn-stats] excluded non-public champions: ${plan.poolSummary.excludedSlugs.join(", ")}`,
    );
  }

  if (plan.missingRequestedSlugs.length) {
    console.warn(
      `[riftgg-cn-stats] requested slugs missing from champions catalog: ${plan.missingRequestedSlugs.join(", ")}`,
    );
  }

  if (plan.excludedRequestedSlugs.length) {
    console.warn(
      `[riftgg-cn-stats] requested slugs excluded from public pool: ${plan.excludedRequestedSlugs.join(", ")}`,
    );
  }
}
