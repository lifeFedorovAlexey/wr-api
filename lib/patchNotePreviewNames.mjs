import { resolveChampionLocalizedName } from "./championLocalization.mjs";
import { normalizePatchChangeEntityClassification } from "./patchNoteEntityClassification.mjs";
import { getRussianPatchEntityName } from "./patchNotesParser.mjs";

function hasCyrillic(value) {
  return /[\u0400-\u04ff]/u.test(String(value || ""));
}

function guideKindFor(entityKind) {
  return entityKind === "spell" ? "summonerSpell" : entityKind;
}

function normalizeAllCapsName(value) {
  const name = String(value || "").trim();
  if (!name || !hasCyrillic(name) || name !== name.toLocaleUpperCase("ru-RU")) return name;
  const lower = name.toLocaleLowerCase("ru-RU");
  return lower.replace(/^[\p{L}]/u, (letter) => letter.toLocaleUpperCase("ru-RU"));
}

const OFFICIAL_ENGLISH_BRAND_NAMES = new Set([
  "system:aaa aram",
  "system:heartsteel",
  "system:true damage",
  "system:rock 'n' pentakill",
]);

function normalizedNameKey(kind, value) {
  return `${kind}:${String(value || "")
    .trim()
    .replace(/[’‘]/gu, "'")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US")}`;
}

/** Resolve a patch identity and report whether its Russian display is trustworthy. */
export function resolvePatchChangeDisplayNameWithStatus(row, catalog) {
  const normalizedRow = normalizePatchChangeEntityClassification(row);
  if (normalizedRow.entityKind === "champion" && normalizedRow.entitySlug) {
    const champion = catalog.champions.get(normalizedRow.entitySlug);
    const localizedName = resolveChampionLocalizedName({
      slug: normalizedRow.entitySlug,
      lang: "ru_ru",
      nameLocalizations: champion?.nameLocalizations || {},
      fallbackName: champion?.name || "",
    });
    if (localizedName && hasCyrillic(localizedName)) {
      return { displayNameRu: normalizeAllCapsName(localizedName), nameStatus: "localized" };
    }
  }

  const guideEntity = normalizedRow.entitySlug
    ? catalog.guideEntities.get(`${guideKindFor(normalizedRow.entityKind)}:${normalizedRow.entitySlug}`)
    : null;
  const mappedName = getRussianPatchEntityName(normalizedRow.entityName, normalizedRow.entityKind, "ru-ru", {
    slug: normalizedRow.entitySlug,
    name: guideEntity?.name,
  });
  if (mappedName) return { displayNameRu: normalizeAllCapsName(mappedName), nameStatus: "localized" };

  const catalogName = normalizedRow.entityKind === "champion"
    ? catalog.champions.get(normalizedRow.entitySlug)?.name
    : guideEntity?.name;
  if (catalogName && hasCyrillic(catalogName)) {
    return { displayNameRu: normalizeAllCapsName(catalogName), nameStatus: "localized" };
  }

  const rawName = String(normalizedRow.entityName || "").trim();
  if (hasCyrillic(rawName)) {
    return { displayNameRu: normalizeAllCapsName(rawName), nameStatus: "localized" };
  }
  const nameStatus = OFFICIAL_ENGLISH_BRAND_NAMES.has(normalizedNameKey(normalizedRow.entityKind, rawName))
    ? "official-brand"
    : "untranslated";
  return { displayNameRu: rawName, nameStatus };
}

/** Use Russian catalog names or vetted patch-name translations in the Russian UI. */
export function resolvePatchChangeDisplayName(row, catalog) {
  return resolvePatchChangeDisplayNameWithStatus(row, catalog).displayNameRu;
}
