function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function localizeRole(value = "") {
  const normalized = cleanText(value).toLowerCase();

  if (normalized.includes("support") || normalized.includes("саппорт")) return "Саппорт";
  if (normalized.includes("mid") || normalized.includes("мид")) return "Мид";
  if (normalized.includes("jungle") || normalized.includes("лес")) return "Лес";
  if (normalized.includes("baron") || normalized.includes("топ")) return "Барон";
  if (normalized.includes("duo")) return "Дуо";
  if (normalized.includes("adc") || normalized.includes("адк")) return "АДК";

  return cleanText(value);
}

export function getGuideRoles(guide) {
  const variants = Array.isArray(guide?.variants) ? guide.variants : [];

  const roles = variants
    .map((variant) => localizeRole(variant?.lane || variant?.title || ""))
    .filter(Boolean);

  return Array.from(new Set(roles));
}

export function summarizeGuide(guide) {
  const variants = Array.isArray(guide?.variants) ? guide.variants : [];
  const defaultVariant =
    variants.find((variant) => variant?.isDefault) || variants[0] || null;

  return {
    slug: guide?.champion?.slug || "",
    name: guide?.champion?.name || "",
    title: guide?.champion?.title || guide?.official?.champion?.title || null,
    icon: guide?.champion?.iconUrl || null,
    patch: guide?.metadata?.patch || null,
    tier: defaultVariant?.ownTier || defaultVariant?.tier || guide?.metadata?.tier || null,
    recommendedRole:
      localizeRole(defaultVariant?.lane || guide?.metadata?.recommendedRole || "") || null,
    roles: getGuideRoles(guide),
    buildCount: variants.length || 1,
    sourceSite: guide?.source?.site || "wildriftfire",
    sourceUrl: guide?.source?.url || null,
    contentHash: guide?.source?.contentHash || null,
    fetchedAt: guide?.source?.fetchedAt || null,
  };
}
