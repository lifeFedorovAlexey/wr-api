// Retain only sources that state the CN version was live, not just scheduled.
const PATCH_EFFECTIVE_DATES = {
  "7.1c": { date: "2026-04-23", region: "CN", sourceUrl: "https://www.wywyx.com/news/202604/560132.html" },
  "7.1b": { date: "2026-04-16", region: "CN", sourceUrl: "https://bbs.4399.cn/thread-view-tid-52692672" },
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
