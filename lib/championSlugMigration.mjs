import { getChampionSlugRecord } from "./championSlug.mjs";

function normalizeSlug(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function classifyChampionSlugMigrations(existingSlugs = [], scrapedSlugs = []) {
  const scrapedSlugSet = new Set(scrapedSlugs.map((slug) => normalizeSlug(slug)).filter(Boolean));
  const aliasMigrations = [];
  const staleSlugs = [];

  for (const rawSlug of existingSlugs) {
    const slug = normalizeSlug(rawSlug);
    if (!slug || scrapedSlugSet.has(slug)) continue;

    const record = getChampionSlugRecord(slug);
    const canonical = normalizeSlug(record?.canonical);
    const legacyLocal = normalizeSlug(record?.legacyLocal);

    if (record && legacyLocal === slug && canonical && scrapedSlugSet.has(canonical)) {
      aliasMigrations.push({ from: slug, to: canonical });
      continue;
    }

    staleSlugs.push(slug);
  }

  return { aliasMigrations, staleSlugs };
}
