function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function getChampionPublicPoolStatus(champion) {
  const names = champion?.nameLocalizations || {};
  const hasRu = hasText(names.ru_ru);
  const hasEn = hasText(names.en_us);

  if (hasRu && hasEn) {
    return {
      isPublic: true,
      isTemporaryEnOnly: false,
      reason: "riot-ru-en",
    };
  }

  if (!hasRu && hasEn) {
    return {
      isPublic: true,
      isTemporaryEnOnly: true,
      reason: "riot-en-only-temporary",
    };
  }

  return {
    isPublic: false,
    isTemporaryEnOnly: false,
    reason: "missing-riot-en",
  };
}

/**
 * Публичные страницы сайта должны показывать только чемпионов из
 * нашего канонического Riot-backed списка. База берётся с ru-ru/champions,
 * но если Riot временно выкатывает чемпиона раньше на en-us, такой чемпион
 * тоже попадает в пул до тех пор, пока ru_ru не догонит каталог.
 *
 * CN-источники могут узнать о новом чемпионе раньше, но в публичный
 * пул он попадает только после того, как его подтянет официальный
 * wildrift.leagueoflegends.com хотя бы на en-us.
 */
export function isChampionInPublicPool(champion) {
  return getChampionPublicPoolStatus(champion).isPublic;
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

export function summarizeChampionPublicPool(rows = []) {
  const summary = {
    total: 0,
    public: 0,
    temporaryEnOnly: 0,
    excluded: 0,
    temporaryEnOnlySlugs: [],
    excludedSlugs: [],
  };

  for (const row of Array.isArray(rows) ? rows : []) {
    summary.total += 1;
    const status = getChampionPublicPoolStatus(row);

    if (status.isPublic) {
      summary.public += 1;
      if (status.isTemporaryEnOnly) {
        summary.temporaryEnOnly += 1;
        if (summary.temporaryEnOnlySlugs.length < 10) {
          summary.temporaryEnOnlySlugs.push(String(row?.slug || "").trim());
        }
      }
      continue;
    }

    summary.excluded += 1;
    if (summary.excludedSlugs.length < 10) {
      summary.excludedSlugs.push(String(row?.slug || "").trim());
    }
  }

  return summary;
}
