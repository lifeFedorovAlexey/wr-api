function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Публичные страницы сайта должны показывать только чемпионов из
 * нашего канонического Riot-backed списка. Практически это значит,
 * что у чемпиона должны быть обе основные Riot-локализации.
 *
 * CN-источники могут узнать о новом чемпионе раньше, но в публичный
 * пул он попадает только после того, как его подтянет официальный
 * wildrift.leagueoflegends.com и у нас появятся нормальные ru/en имена.
 */
export function isChampionInPublicPool(champion) {
  const names = champion?.nameLocalizations || {};

  return hasText(names.ru_ru) && hasText(names.en_us);
}

export function filterChampionsForPublicPool(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) =>
    isChampionInPublicPool(row),
  );
}

export function buildPublicChampionSlugSet(rows = []) {
  return new Set(
    filterChampionsForPublicPool(rows)
      .map((row) => String(row?.slug || "").trim())
      .filter(Boolean),
  );
}
