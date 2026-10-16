// Retain only sources that state the CN version was live, not just scheduled.
const PATCH_EFFECTIVE_DATES = {
  "7.3": { date: "2026-09-22", region: "CN", sourceUrl: "https://game.xiaomi.com/viewpoint/1359077112_1790049273565_149" },
  "7.2b": { date: "2026-07-30", region: "CN", sourceUrl: "https://m.wywyx.com/news/202607/581297.html" },
  "7.2": { date: "2026-07-09", region: "CN", sourceUrl: "https://www.lolfun.cn/news/detail/22289.html" },
  "7.1": { date: "2026-04-09", region: "CN", sourceUrl: "https://www.qieyou.com/content/155989" },
};

export function getPatchEffectiveDateMetadata(version) {
  const record = PATCH_EFFECTIVE_DATES[String(version || "").toLowerCase()];
  return {
    effectiveDate: record?.date || null,
    effectiveRegion: record?.region || null,
    effectiveDateSourceUrl: record?.sourceUrl || null,
  };
}
