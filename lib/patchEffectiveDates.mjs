// Dates are included only when a source documents the client/update live in CN,
// rather than only announcing a planned maintenance window. This is separate
// from the Riot article publication timestamp.
const PATCH_EFFECTIVE_DATES = {
  "7.3": { date: "2026-09-22", region: "CN", sourceUrl: "https://www.sina.cn/news/detail/5345630992207444.html" },
  "7.2d": { date: "2026-08-27", region: "CN", sourceUrl: "https://www.sina.cn/news/detail/5336208885940273.html" },
  "7.2c": { date: "2026-08-13", region: "CN", sourceUrl: "https://www.sina.cn/news/detail/5331135454516873.html" },
  "7.2a": { date: "2026-07-16", region: "CN", sourceUrl: "https://www.sina.cn/news/detail/5320988644344860.html" },
  "7.2": { date: "2026-07-09", region: "CN", sourceUrl: "https://www.sina.cn/news/detail/5318451914866756.html" },
  "7.1h": { date: "2026-06-25", region: "CN", sourceUrl: "https://www.weibo.com/ttarticle/p/show?id=2309405313387281645695" },
  "7.1f": { date: "2026-05-28", region: "CN", sourceUrl: "https://weibo.com/ttarticle/p/show?id=2309405303231655051576" },
  "7.0c": { date: "2026-02-12", region: "CN", sourceUrl: "https://www.bilibili.com/opus/1168067930157482072" },
  "7.1": { date: "2026-04-09", region: "CN", sourceUrl: "https://www.sina.cn/news/detail/5293319777160733.html" },
};

export function getPatchEffectiveDateMetadata(version) {
  const record = PATCH_EFFECTIVE_DATES[String(version || "").toLowerCase()];
  return {
    effectiveDate: record?.date || null,
    effectiveRegion: record?.region || null,
    effectiveDateSourceUrl: record?.sourceUrl || null,
  };
}
