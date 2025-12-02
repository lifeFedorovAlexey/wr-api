// utils/slugRemap.mjs
// Маппинг slug'ов из китайской базы → slug'и у Riot Wild Rift

export const SLUG_RIOT_REMAP = {
  nunu: "nunu-willump",
  monkeyking: "wukong",
  xinzhao: "xin-zhao",
  aurelionsol: "aurelion-sol",
  jarvaniv: "jarvan-iv",
  leesin: "lee-sin",
  drmundo: "dr-mundo",
  missfortune: "miss-fortune",
  twistedfate: "twisted-fate",
  masteryi: "master-yi",
};

export function mapToRiotSlug(cnSlug) {
  return SLUG_RIOT_REMAP[cnSlug] ?? cnSlug;
}

// Ручные фиксы имён, если после скрапа что-то не нашлось.
// Ключ — ТВОЙ slug (из CN), не riot-овский.
export const NAME_PATCHES = {
  nunu: {
    en_us: "Nunu & Willump",
    ru_ru: "Нуну и Виллумп",
  },
  monkeyking: {
    ru_ru: "Вуконг",
  },
  xinzhao: {
    ru_ru: "Син Чжао",
  },
  aurelionsol: {
    ru_ru: "Аурелион Сол",
  },
  jarvaniv: {
    ru_ru: "Джарван IV",
  },
  leesin: {
    ru_ru: "Ли Син",
  },
  drmundo: {
    ru_ru: "Доктор Мундо",
  },
  missfortune: {
    ru_ru: "Мисс Фортуна",
  },
  twistedfate: {
    ru_ru: "Твистед Фэйт",
  },
  masteryi: {
    ru_ru: "Мастер Йи",
  },
};
