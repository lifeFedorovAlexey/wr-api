import { comparePatchVersions, parsePatchVersion } from "./patchVersion.mjs";

const RIOT_HOST = "wildrift.leagueoflegends.com";
const RIOT_EN_ARTICLE_PATH = /^\/en-us\/news\/(?:game-updates|dev)\/(?:wild-rift-(?:patch-notes|patch)-[a-z0-9-]+|wild-rift-[a-z0-9-]+-patch-notes)\/?$/i;

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid Riot patch-note archive audit: ${message}`);
}

function validatePage(page, source) {
  assert(page && typeof page === "object", `${source} page is not an object`);
  assert(typeof page.version === "string" && parsePatchVersion(page.version)?.value === page.version.toLowerCase(), `${source} page has an invalid patch version`);
  assert(page.status === "parsed", `${source} page ${page.version} was not parsed`);
  assert(page.locale === "en-us", `${source} page ${page.version} is not an English US source`);
  let url;
  try { url = new URL(page.url); } catch { throw new Error(`Invalid Riot patch-note archive audit: ${source} page ${page.version} has an invalid URL`); }
  assert(url.protocol === "https:" && url.hostname.toLowerCase() === RIOT_HOST && RIOT_EN_ARTICLE_PATH.test(url.pathname), `${source} page ${page.version} is not an official English Riot patch-note URL`);
  return { version: page.version.toLowerCase(), url: url.toString(), source };
}

function uniquePages(pages, source) {
  assert(Array.isArray(pages), `${source} pages are missing`);
  const byVersion = new Map();
  for (const page of pages) {
    const entry = validatePage(page, source);
    assert(!byVersion.has(entry.version), `${source} has duplicate version ${entry.version}`);
    byVersion.set(entry.version, entry);
  }
  return byVersion;
}

/** Convert a completed offline/live archive audit into a fail-closed patch sequence. */
export function buildValidatedRiotPatchArchiveManifest(report) {
  assert(report && typeof report === "object", "report is missing");
  assert(["offline-cache", "live-index-cached-read-only"].includes(report.mode), "audit mode is unknown");
  assert(Number.isFinite(Date.parse(report.generatedAt)), "audit timestamp is missing or invalid");

  const indexPages = uniquePages(report.riotEnPages, "Riot English index");
  const indexCounts = report.sourceIndexes?.riotEn;
  const indexSummary = report.riot?.["en-us"];
  assert(indexCounts?.count === indexPages.size && indexCounts?.uniqueVersions === indexPages.size, "Riot English index counts do not match its pages");
  assert(indexSummary?.indexed === indexPages.size && indexSummary?.parsed === indexPages.size && indexSummary?.failed === 0, "Riot English index contains unparsed pages");

  const missingFromIndex = report.coverage?.rpnVersionsNotInRiotEnIndex;
  const unresolvedRpnSources = report.coverage?.rpnVersionsWithoutValidatedRiotSource;
  assert(Array.isArray(missingFromIndex), "RiftPatchNotes coverage against Riot is missing");
  assert(Array.isArray(unresolvedRpnSources) && unresolvedRpnSources.length === 0, "some RiftPatchNotes versions have no validated Riot source");

  const directPages = uniquePages(report.riotDirectFallbackPages, "validated direct Riot source");
  const directSummary = report.riotDirectFallback;
  assert(directSummary?.indexed === directPages.size && directSummary?.parsed === directPages.size && directSummary?.failed === 0, "direct Riot source counts do not match parsed pages");
  const expectedDirectVersions = new Set(missingFromIndex.map((version) => String(version).toLowerCase()));
  assert(expectedDirectVersions.size === missingFromIndex.length, "RiftPatchNotes has duplicate versions missing from the Riot index");
  assert(expectedDirectVersions.size === directPages.size && [...expectedDirectVersions].every((version) => directPages.has(version)), "not every RiftPatchNotes version missing from the Riot index has a parsed Riot source");
  for (const version of directPages.keys()) {
    assert(!indexPages.has(version), `direct source ${version} duplicates the Riot English index`);
  }

  const versions = [...indexPages.values(), ...directPages.values()]
    .sort((left, right) => comparePatchVersions(right.version, left.version));
  return {
    source: "validated-riot-english-patch-note-archive",
    generatedAt: report.generatedAt,
    auditMode: report.mode,
    complete: true,
    versions,
  };
}
