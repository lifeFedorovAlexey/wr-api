// A successful process exit must mean every attempted article was imported or
// was already current; the scrape coordinator uses that exit to record freshness.
export async function runPatchNotesImport({ loadIndex, loadReadyEnglish, importPatch, markFailed, catalog, forceRefresh = false, log = console }) {
  const failures = [];
  async function runPhase(items, locale, latestVersion) {
    for (const item of items) {
      try {
        const result = await importPatch(item, locale, {
          force: forceRefresh || item.version === latestVersion,
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
  const englishItems = await loadIndex("en-us");
  await runPhase(englishItems, "en-us", englishItems[0]?.version);
  const englishVersions = new Set(await loadReadyEnglish());

  log.log("[patch-notes] Russian import phase started after English phase");
  const russianItems = await loadIndex("ru-ru");
  const russianByVersion = new Map(russianItems.map(item => [item.version, item]));
  await runPhase([...englishVersions].map(version => russianByVersion.get(version)).filter(Boolean), "ru-ru", russianItems[0]?.version);

  if (failures.length) throw new Error(`Patch-note import incomplete: ${failures.length} article(s) failed (${failures.join(", ")})`);
  log.log(`[patch-notes] finished: ${englishVersions.size} English versions available`);
}
