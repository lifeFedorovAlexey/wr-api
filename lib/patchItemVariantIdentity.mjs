function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const YORDLE_VARIANT_SLUG_PREFIX = "variant-yordle-";

function findBaseItem(baseName, itemsByAlias) {
  const matches = new Map();
  for (const [alias, entity] of itemsByAlias || []) {
    const normalizedAlias = normalizeName(alias);
    if (!entity?.slug || /^(?:yordle|[ий]ордл(?:овск\p{L}*|ы)?)\s+/u.test(normalizedAlias)) continue;
    if (normalizedAlias === baseName || normalizedAlias.endsWith(` ${baseName}`)) {
      matches.set(entity.slug, entity);
    }
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

function buildVariantEntity(baseItem, sourceName, slug = null) {
  return {
    ...baseItem,
    slug: slug || `${YORDLE_VARIANT_SLUG_PREFIX}${baseItem.slug}`,
    name: sourceName || `Yordle ${baseItem.name || baseItem.slug}`,
    baseItemSlug: baseItem.slug,
    itemVariant: "yordle",
  };
}

export function resolveQualifiedItemVariant(value, itemsByAlias) {
  const sourceName = String(value || "").replace(/\s+/g, " ").trim();
  const normalizedName = normalizeName(sourceName);
  const match = normalizedName.match(/^(?:yordle|[ий]ордл(?:овск\p{L}*|ы)?)\s+(.+)$/u);
  if (!match) return null;
  const baseItem = findBaseItem(match[1], itemsByAlias);
  return baseItem ? buildVariantEntity(baseItem, sourceName) : null;
}

export function resolveQualifiedItemVariantBySlug(slug, itemsByAlias, sourceName = null) {
  const value = String(slug || "");
  if (!value.startsWith(YORDLE_VARIANT_SLUG_PREFIX)) return null;
  const baseSlug = value.slice(YORDLE_VARIANT_SLUG_PREFIX.length);
  const baseItems = new Map();
  for (const entity of itemsByAlias?.values?.() || []) {
    if (entity?.slug === baseSlug) baseItems.set(entity.slug, entity);
  }
  const baseItem = baseItems.values().next().value;
  return baseItem ? buildVariantEntity(baseItem, sourceName, value) : null;
}

export function findQualifiedItemVariantMentions(value, itemsByAlias) {
  const normalizedText = normalizeName(value);
  const tokens = Array.from(normalizedText.matchAll(/\S+/g), (match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const mentions = [];

  for (let index = 0; index < tokens.length; index += 1) {
    if (!/^(?:yordle|[ий]ордл(?:овск\p{L}*|ы)?)$/u.test(tokens[index].value)) continue;
    let best = null;
    for (let endIndex = index + 2; endIndex <= Math.min(tokens.length, index + 10); endIndex += 1) {
      const sourceName = tokens.slice(index, endIndex).map(({ value: token }) => token).join(" ");
      const entity = resolveQualifiedItemVariant(sourceName, itemsByAlias);
      if (entity) {
        best = {
          alias: sourceName,
          entity: resolveQualifiedItemVariantBySlug(entity.slug, itemsByAlias),
          start: tokens[index].start,
          end: tokens[endIndex - 1].end,
          length: tokens[endIndex - 1].end - tokens[index].start,
        };
      }
    }
    if (best) mentions.push(best);
  }

  return mentions;
}
