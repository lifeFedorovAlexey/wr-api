import { normalizePatchChangeEntityClassification } from "./patchNoteEntityClassification.mjs";

const ENTITY_KINDS = ["champion", "item", "rune", "spell", "skin", "system"];
const PUBLIC_KIND_NAMES = {
  champion: "champions",
  item: "items",
  rune: "runes",
  spell: "spells",
  skin: "skins",
  system: "system",
};
const CHROMA_COLOR_WORD = "(?:amber|yellow|gold|orange|red|crimson|pink|purple|violet|blue|cyan|teal|green|emerald|black|white|silver|bronze|dark|light|янтарн|ж[её]лт|золот|оранжев|красн|ал|розов|пурпур|фиолетов|син|голуб|бирюз|зел[её]н|изумруд|ч[её]рн|бел|сер|серебр|бронз|т[её]мн|светл)\\p{L}*";
const CHROMA_COLOR_LABEL = new RegExp(`^(?:(?:dark|light|темно|тёмно|светло)[-\\s]+)?${CHROMA_COLOR_WORD}$`, "iu");

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

function isChromaFamily(row) {
  return /(?:chromas?|цветов\p{L}*\s+схем\p{L}*)$/iu.test(String(row.entityName || "").trim())
    || /(?:^|-)chromas?$/iu.test(String(row.entitySlug || "").trim());
}

function identityFor(row, skinRows) {
  if (row.entityKind === "skin") {
    if (isChromaFamily(row)) {
      const championPrefix = normalize(row.entitySlug).split("-")[0];
      const hasVariants = skinRows.some((candidate) => candidate !== row
        && isLikelyChromaVariant(candidate)
        && normalize(candidate.entitySlug).startsWith(`${championPrefix}-`));
      if (hasVariants) return null;
      return normalize(String(row.entityName || "").replace(/\s+(?:chromas?|цветов\p{L}*\s+схем\p{L}*)$/iu, ""))
        || normalize(row.entitySlug);
    }
    const variantBase = chromaVariantBaseName(row);
    if (variantBase) {
      const baseIdentity = normalize(variantBase);
      const siblings = skinRows.filter((candidate) => {
        if (candidate === row || isChromaFamily(candidate)) return false;
        const candidateBase = chromaVariantBaseName(candidate);
        return candidateBase
          ? normalize(candidateBase) === baseIdentity
          : normalize(candidate.entityName) === baseIdentity;
      });
      const variantCount = siblings.filter(isLikelyChromaVariant).length + 1;
      const hasBaseSkin = siblings.some((candidate) => !isLikelyChromaVariant(candidate));
      if (hasBaseSkin || variantCount >= 2) return baseIdentity;
    }
    return normalize(row.entityName) || normalize(row.entitySlug);
  }
  if (row.entitySlug) return normalize(row.entitySlug);
  return normalize(row.entityName);
}

function chromaVariantBaseName(row) {
  const match = String(row.entityName || "").trim().match(/^(.+?)\s+\(([^()]+)\)$/u);
  if (!match || !isChromaColorLabel(match[2])) return null;
  return match[1].trim() || null;
}

function isLikelyChromaVariant(row) {
  return Boolean(chromaVariantBaseName(row));
}

function isChromaColorLabel(value) {
  const label = String(value || "").trim();
  if (/^[A-Z][A-Z0-9-]{1,9}$/u.test(label)) return true;
  return CHROMA_COLOR_LABEL.test(label);
}

/** Count distinct changed entities in each patch locale, regardless of icons. */
export function countPatchChangeEntities(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  rows = rows.map(normalizePatchChangeEntityClassification);

  const byPatchLocale = new Map();
  const skinRowsByPatchLocale = new Map();
  for (const row of rows) {
    if (row.entityKind !== "skin") continue;
    const key = `${String(row.patchVersion || "").trim()}:${String(row.locale || "").trim()}`;
    const skinRows = skinRowsByPatchLocale.get(key) || [];
    skinRows.push(row);
    skinRowsByPatchLocale.set(key, skinRows);
  }

  for (const row of rows) {
    if (!ENTITY_KINDS.includes(row.entityKind)) continue;
    const patchVersion = String(row.patchVersion || "").trim();
    const locale = String(row.locale || "").trim();
    if (!patchVersion || !locale) continue;

    const key = `${patchVersion}:${locale}`;
    const skinRows = skinRowsByPatchLocale.get(key) || [];
    const identity = identityFor(row, skinRows);
    if (!identity) continue;
    let kinds = byPatchLocale.get(key);
    if (!kinds) {
      kinds = new Map(ENTITY_KINDS.map((kind) => [kind, new Set()]));
      byPatchLocale.set(key, kinds);
    }
    kinds.get(row.entityKind).add(identity);
  }

  return new Map([...byPatchLocale].map(([key, kinds]) => {
    const counts = Object.fromEntries(ENTITY_KINDS.map((kind) => [PUBLIC_KIND_NAMES[kind], kinds.get(kind).size]));
    counts.total = ENTITY_KINDS.reduce((sum, kind) => sum + kinds.get(kind).size, 0);
    return [key, counts];
  }));
}
