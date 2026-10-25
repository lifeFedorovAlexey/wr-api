import { createHash } from "node:crypto";

export const HUB_GAME_RUNES_DATASET = "runes";

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Build current Hub rune snapshots only; the Hub catalog exposes no rune history routes. */
export function buildHubGameRuneSnapshotRows(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.runes)) {
    throw new TypeError("A parsed Hub Game rune catalog is required");
  }
  const patchVersion = requiredText(catalog.source?.snapshot?.version, "catalog.source.snapshot.version");
  const sourceUpdatedAt = requiredText(catalog.source?.snapshot?.updatedAt, "catalog.source.snapshot.updatedAt");
  const sourceKind = requiredText(catalog.source?.kind, "catalog.source.kind");
  const sourceUrl = requiredText(catalog.source?.url, "catalog.source.url");
  if (catalog.source?.locale !== "en") throw new Error("Hub rune snapshot must use the English catalog");
  if (!Number.isInteger(catalog.count) || catalog.count < 1 || catalog.runes.length !== catalog.count) {
    throw new Error("Hub rune catalog has an invalid rune count");
  }

  const slugs = new Set();
  const sourceEvidence = [{
    kind: sourceKind,
    role: "rune-catalog",
    url: sourceUrl,
    sourcePatchVersion: patchVersion,
    sourceUpdatedAt,
    listedRuneCount: catalog.count,
    translatedFromJapanese: catalog.source.snapshot.translatedFromJapanese === true,
    runesWithStructuredValueLines: catalog.runes.filter((rune) => Array.isArray(rune.values) && rune.values.length > 0).length,
    descriptionOnlyRunes: catalog.runes.filter((rune) => Array.isArray(rune.values) && rune.values.length === 0).length,
    historyCoverage: "not-provided-on-catalog",
  }];

  const rows = catalog.runes.map((rune) => {
    const entitySlug = requiredText(rune.slug, "rune.slug");
    if (slugs.has(entitySlug)) throw new Error(`Duplicate Hub rune slug: ${entitySlug}`);
    slugs.add(entitySlug);
    const name = requiredText(rune.name, `rune ${entitySlug} name`);
    const path = requiredText(rune.path, `rune ${entitySlug} path`);
    const image = requiredText(rune.image, `rune ${entitySlug} image`);
    const effectText = requiredText(rune.effectText, `rune ${entitySlug} effectText`);
    if (!Array.isArray(rune.values)) throw new Error(`Rune ${entitySlug} has invalid values`);

    const state = {
      name,
      slugSource: rune.slugSource ?? null,
      path,
      category: requiredText(rune.category, `rune ${entitySlug} category`),
      image,
      description: requiredText(rune.description, `rune ${entitySlug} description`),
      values: rune.values,
      effectText,
      dataCoverage: rune.values.length > 0 ? "catalog-card-with-structured-value-lines" : "catalog-card-description-only",
      source: {
        sourceKind,
        sourceUrl,
        patchVersion,
        sourceUpdatedAt,
        sourceLocale: "en",
        translatedFromJapanese: catalog.source.snapshot.translatedFromJapanese === true,
        historicalReconstruction: "not-performed",
        historyCoverage: "not-provided-on-catalog",
      },
    };

    return {
      patchVersion,
      dataset: HUB_GAME_RUNES_DATASET,
      entityKind: "rune",
      entitySlug,
      state,
      sourceKind,
      sourceUrl,
      sourcePatchVersion: patchVersion,
      sourceUpdatedAt,
      verificationStatus: "verified",
      sourceEvidence,
      contentHash: stableHash(state),
    };
  });
  return rows;
}

/** Refuse to rewrite or partially extend an existing immutable dataset/patch snapshot. */
export function assertImmutableRuneSnapshot(existingRows, incomingRows) {
  if (!Array.isArray(existingRows) || !Array.isArray(incomingRows) || incomingRows.length === 0) {
    throw new TypeError("Existing rows must be an array and incoming rune snapshot rows must be non-empty");
  }
  if (existingRows.length === 0) return { unchanged: 0 };

  const incomingBySlug = new Map(incomingRows.map((row) => [row.entitySlug, row.contentHash]));
  const existingBySlug = new Map(existingRows.map((row) => [row.entity_slug, row.content_hash]));
  const missingFromIncoming = [...existingBySlug.keys()].filter((slug) => !incomingBySlug.has(slug));
  const newInIncoming = [...incomingBySlug.keys()].filter((slug) => !existingBySlug.has(slug));
  const changed = [...existingBySlug]
    .filter(([slug, hash]) => incomingBySlug.has(slug) && incomingBySlug.get(slug) !== hash)
    .map(([slug]) => slug);
  if (missingFromIncoming.length || newInIncoming.length || changed.length) {
    const details = [
      missingFromIncoming.length && `missing from source: ${missingFromIncoming.join(", ")}`,
      newInIncoming.length && `new source rows: ${newInIncoming.join(", ")}`,
      changed.length && `changed values: ${changed.join(", ")}`,
    ].filter(Boolean).join("; ");
    throw new Error(`Refusing to mutate immutable rune snapshot: ${details}`);
  }
  return { unchanged: existingRows.length };
}
