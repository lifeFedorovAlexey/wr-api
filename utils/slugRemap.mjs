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

// Ручные фиксы имён, если после скрапа что-то не нашлось
// Ключ — ТВОЙ slug (из CN), не riot-овский.
export const NAME_PATCHES = {
  nunu: {
    // Если en_us так и не нашёлся, принудительно задаём
    en_us: "Nunu & Willump",
  },
};
