const LOCALIZED_NAME_OVERRIDES = {
  ksante: {
    ru_ru: "К'Санте",
  },
};

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsCjk(value = "") {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

export function resolveChampionLocalizedName({
  slug = "",
  lang = "ru_ru",
  nameLocalizations = {},
  fallbackName = "",
}) {
  const normalizedSlug = cleanText(slug).toLowerCase();
  const normalizedLang = cleanText(lang).toLowerCase();
  const overrides = LOCALIZED_NAME_OVERRIDES[normalizedSlug] || {};

  if (overrides[normalizedLang]) {
    return overrides[normalizedLang];
  }

  const requested = cleanText(nameLocalizations?.[normalizedLang]);
  if (requested && !containsCjk(requested)) {
    return requested;
  }

  const english = cleanText(nameLocalizations?.en_us);
  if (english && !containsCjk(english)) {
    return english;
  }

  const fallback = cleanText(fallbackName);
  if (fallback) {
    return fallback;
  }

  return null;
}
