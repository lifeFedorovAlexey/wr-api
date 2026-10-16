// Retain only sources that state the CN version was live, not just scheduled.
const PATCH_EFFECTIVE_DATES = {
  "7.3a": { date: "2026-09-29", region: "CN", sourceUrl: "https://a.4399.cn/gg/54242290_141120.html" },
  "7.1c": { date: "2026-04-23", region: "CN", sourceUrl: "https://www.wywyx.com/news/202604/560132.html" },
  "7.1h": { date: "2026-06-25", region: "CN", sourceUrl: "https://www.weibo.com/ttarticle/p/show?id=2309405313387281645695" },
  "7.1f": { date: "2026-05-28", region: "CN", sourceUrl: "https://weibo.com/ttarticle/p/show?id=2309405303231655051576" },
  "7.1e": { date: "2026-05-14", region: "CN", sourceUrl: "https://community-cn.honor.com/cngm/game/topicdetail/topicid-3730272558907392" },
  "7.1d": { date: "2026-04-30", region: "CN", sourceUrl: "https://www.sina.cn/news/detail/5292840062025983.html" },
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
