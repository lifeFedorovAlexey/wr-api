// Dates are included only when a source documents the client/update live in CN,
// rather than only announcing a planned maintenance window. This is separate
// from the Riot article publication timestamp.
const PATCH_EFFECTIVE_DATES = {
  "7.3": { date: "2026-09-22", region: "CN", sourceUrl: "https://apps.apple.com/cn/app/%E8%8B%B1%E9%9B%84%E8%81%94%E7%9B%9F%E6%89%8B%E6%B8%B8/id1455054000" },
  "7.0c": { date: "2026-02-12", region: "CN", sourceUrl: "https://www.bilibili.com/opus/1168067930157482072" },
  "7.1e": { date: "2026-05-14", region: "CN", sourceUrl: "https://community-cn.honor.com/cngm/game/topicdetail/topicid-3730272558907392" },
  "7.1b": { date: "2026-04-16", region: "CN", sourceUrl: "https://bbs.4399.cn/thread-view-tid-52692672" },
  "7.1": { date: "2026-04-09", region: "CN", sourceUrl: "https://apps.apple.com/cn/app/%E8%8B%B1%E9%9B%84%E8%81%94%E7%9B%9F%E6%89%8B%E6%B8%B8/id1455054000?platform=vision" },
};

export function getPatchEffectiveDateMetadata(version) {
  const record = PATCH_EFFECTIVE_DATES[String(version || "").toLowerCase()];
  return {
    effectiveDate: record?.date || null,
    effectiveRegion: record?.region || null,
    effectiveDateSourceUrl: record?.sourceUrl || null,
  };
}
