// A successful process exit must mean every attempted article was imported or
// was already current; the scrape coordinator uses that exit to record freshness.
export async function runPatchNotesImport({ loadIndex, loadArchived = async () => [], loadReadyEnglish, importPatch, markFailed, catalog, forceRefresh = false, reparseArchived = false, requestedVersions = [], log = console }) {
  const failures = [];
  const requested = new Set(requestedVersions);
  async function loadItems(locale) {
    if (requested.size) return { items: [...requested].map(version => ({
      version,
      locale,
      title: locale === "ru-ru" ? `Описание обновления ${version} для Wild Rift` : `Wild Rift Patch Notes ${version}`,
      description: "",
      url: `https://wildrift.leagueoflegends.com/${locale}/news/game-updates/wild-rift-patch-notes-${version.replace(".", "-")}/`,
      publishedAt: null,
      imageUrl: null,
    })) };
    const indexItems = await loadIndex(locale);
    const byVersion = new Map((await loadArchived(locale, { all: reparseArchived })).map(item => [item.version, item]));
    for (const item of indexItems) byVersion.set(item.version, { ...byVersion.get(item.version), ...item });
    const items = [...byVersion.values()].sort((left, right) => {
      const a = String(left.version).match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
      const b = String(right.version).match(/^(\d+)\.(\d+)([a-z]?)$/i) || [];
      return Number(b[1] || 0) - Number(a[1] || 0) || Number(b[2] || 0) - Number(a[2] || 0)
        || String(b[3] || "").localeCompare(String(a[3] || ""));
    });
    return { items, latestVersion: indexItems[0]?.version };
  }
  async function runPhase(items, locale, latestVersion) {
    for (const item of items) {
      try {
        const result = await importPatch(item, locale, {
          force: forceRefresh || requested.has(item.version) || item.version === latestVersion,
          reparse: reparseArchived,
          catalog,
        });
        if (result === "failed") failures.push(`${locale} ${item.version}`);
      } catch (error) {
        failures.push(`${locale} ${item.version}`);
        log.error(`[patch-notes] ${locale} ${item.version}: ${error.stack || error}`);
        await markFailed(locale, item.version, error).catch(() => undefined);
      }
    }
  }

  log.log("[patch-notes] English import phase started");
  const english = await loadItems("en-us");
  await runPhase(english.items, "en-us", english.latestVersion);
  const englishVersions = new Set(await loadReadyEnglish());

  log.log("[patch-notes] Russian import phase started after English phase");
  const russian = await loadItems("ru-ru");
  const russianByVersion = new Map(russian.items.map(item => [item.version, item]));
  await runPhase([...englishVersions].map(version => russianByVersion.get(version)).filter(Boolean), "ru-ru", russian.latestVersion);

  if (failures.length) throw new Error(`Patch-note import incomplete: ${failures.length} article(s) failed (${failures.join(", ")})`);
  log.log(`[patch-notes] finished: ${englishVersions.size} English versions available${requested.size ? `; explicitly requested ${[...requested].join(", ")}` : ""}`);
}
