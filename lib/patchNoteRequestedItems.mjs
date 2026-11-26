export function selectRequestedPatchItems(requestedVersions, indexItems, archivedItems, locale) {
  const byVersion = new Map();
  for (const item of archivedItems) byVersion.set(item.version, item);
  for (const item of indexItems) {
    byVersion.set(item.version, { ...byVersion.get(item.version), ...item });
  }

  return requestedVersions.map((version) => byVersion.get(version) || {
    version,
    locale,
    title: locale === "ru-ru" ? `Описание обновления ${version} для Wild Rift` : `Wild Rift Patch Notes ${version}`,
    description: "",
    url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-${version.replace(".", "-")}/`,
    publishedAt: null,
    imageUrl: null,
    generatedFallbackUrl: true,
  });
}

export function resolveRequestedPatchItem(item, {
  auditedArchiveItem = null,
  locale,
  offline = false,
  useAuditedArchiveCache = false,
} = {}) {
  if (auditedArchiveItem) {
    if (item.generatedFallbackUrl) return auditedArchiveItem;
    return { ...auditedArchiveItem, ...item, auditedArchive: auditedArchiveItem.auditedArchive };
  }

  if (locale === "ru-ru" && offline && useAuditedArchiveCache && item.generatedFallbackUrl) {
    return { ...item, url: null, offlineSourceStatus: "unverified-not-cached" };
  }

  return item;
}

export function isMissingRussianFallbackArticle(item, locale, error) {
  return locale === "ru-ru" && item.generatedFallbackUrl === true && error?.status === 404;
}
