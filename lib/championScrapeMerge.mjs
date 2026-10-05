function mergeLocalizedArrays(preferred = {}, fallback = {}) {
  return {
    ru_ru:
      Array.isArray(preferred?.ru_ru) && preferred.ru_ru.length > 0
        ? preferred.ru_ru
        : Array.isArray(fallback?.ru_ru)
          ? fallback.ru_ru
          : [],
    en_us:
      Array.isArray(preferred?.en_us) && preferred.en_us.length > 0
        ? preferred.en_us
        : Array.isArray(fallback?.en_us)
          ? fallback.en_us
          : [],
    zh_cn:
      Array.isArray(preferred?.zh_cn) && preferred.zh_cn.length > 0
        ? preferred.zh_cn
        : Array.isArray(fallback?.zh_cn)
          ? fallback.zh_cn
          : [],
  };
}

function mergeLocalizedStrings(preferred = {}, fallback = {}) {
  return {
    ru_ru: preferred?.ru_ru || fallback?.ru_ru || null,
    en_us: preferred?.en_us || fallback?.en_us || null,
    zh_cn: preferred?.zh_cn || fallback?.zh_cn || null,
  };
}

function mergeChampionNames(champion, existingRow) {
  const names = champion?.names || {};
  const existingNames = existingRow?.nameLocalizations || {};
  return {
    ru_ru: names.ru_ru || existingNames.ru_ru || null,
    en_us: names.en_us || existingNames.en_us || null,
    zh_cn: names.zh_cn || existingNames.zh_cn || null,
  };
}

function mergeChampionRoles(champion, existingRow) {
  const scrapedRoles = Array.isArray(champion?.roles) ? champion.roles : [];
  const existingRoles = Array.isArray(existingRow?.roles) ? existingRow.roles : [];
  return scrapedRoles.length > 0 ? scrapedRoles : existingRoles;
}

function mergeChampionLocalizedFields(champion, existingRow) {
  return {
    rolesLocalized: mergeLocalizedArrays(
      champion?.rolesLocalized,
      existingRow?.rolesLocalizations,
    ),
    difficultyLocalized: mergeLocalizedStrings(
      champion?.difficultyLocalized,
      existingRow?.difficultyLocalizations,
    ),
  };
}

export function mergeScrapedChampionWithExistingRow(champion, existingRow) {
  const localizedFields = mergeChampionLocalizedFields(champion, existingRow);

  return {
    ...champion,
    cnHeroId: champion?.cnHeroId || existingRow?.cnHeroId || null,
    names: mergeChampionNames(champion, existingRow),
    roles: mergeChampionRoles(champion, existingRow),
    difficulty: champion?.difficulty || existingRow?.difficulty || null,
    icon: champion?.icon || existingRow?.icon || null,
    ...localizedFields,
  };
}
