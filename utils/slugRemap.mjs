import {
  getChampionSlugAliases,
  toCanonicalChampionSlug,
  toLegacyLocalChampionSlug,
} from "../lib/championSlug.mjs";

export const SLUG_RIOT_REMAP = {
  nunu: "nunu-and-willump",
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
  return toCanonicalChampionSlug("legacyLocal", cnSlug) || String(cnSlug || "").trim();
}

export function mapToLocalSlug(riotSlug) {
  return toLegacyLocalChampionSlug(riotSlug) || String(riotSlug || "").trim();
}

export function getSlugAliases(slug) {
  return getChampionSlugAliases(slug);
}

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
