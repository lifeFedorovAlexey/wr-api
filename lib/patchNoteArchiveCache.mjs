import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { buildValidatedRiotPatchArchiveManifest } from "./riotPatchNoteArchiveManifest.mjs";
import { comparePatchVersions, isValidPatchVersion } from "./patchVersion.mjs";
import { extractPatchArticleMetadata, extractPatchVersion, isProvenRiotArticleAlias } from "./patchNotesParser.mjs";

const RIOT_HOST = "wildrift.leagueoflegends.com";
const RIOT_PATH = /^\/(en-us|ru-ru)\/news\/(?:game-updates|dev)\/(?:wild-rift-(?:patch-notes|patch)-[a-z0-9-]+|wild-rift-[a-z0-9-]+-patch-notes|opisanie-obnovleniya-[a-z0-9-]+-dlya-wild-rift)\/?$/i;

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid cached Riot patch archive: ${message}`);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizeArticleUrl(value) {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return null;
  }
}

async function resolveCacheFile(cacheRoot, value) {
  assert(typeof value === "string" && value.trim(), "article cache path is missing");
  const realRoot = await realpath(cacheRoot);
  const resolved = await realpath(path.resolve(value));
  assert(isInside(realRoot, resolved), "article cache path escapes the ignored audit cache");
  return resolved;
}

async function assertRiotPage(page, locale, manifestUrls, cacheFile) {
  assert(page && typeof page === "object", "article page is missing");
  assert(page.status === "parsed", `patch ${page.version} is not validated as parsed`);
  assert(page.locale === locale, `patch ${page.version} has locale ${page.locale}, expected ${locale}`);
  assert(isValidPatchVersion(page.version), `patch version ${page.version} is invalid`);

  let url;
  try { url = new URL(page.url); }
  catch { throw new Error(`Invalid cached Riot patch archive: patch ${page.version} has an invalid source URL`); }

  assert(url.protocol === "https:" && url.hostname.toLowerCase() === RIOT_HOST, `patch ${page.version} is not from Riot`);
  assert(RIOT_PATH.test(url.pathname), `patch ${page.version} has an unsupported Riot article route`);
  assert(url.pathname.split("/")[1].toLowerCase() === locale, `patch ${page.version} source URL does not match locale ${locale}`);
  if (locale === "en-us") {
    assert(manifestUrls.get(page.version) === url.toString(), `patch ${page.version} is outside the validated English archive manifest`);
    if (page.sourceAlias && !extractPatchVersion("", url.toString())) {
      const article = extractPatchArticleMetadata(await readFile(cacheFile, "utf8"));
      assert(!extractPatchVersion(article.title, "")
        && normalizeArticleUrl(article.url) === normalizeArticleUrl(url.toString())
        && isProvenRiotArticleAlias(article, article.title, page.version, page.sourceAlias),
      "source alias does not match its Riot article provenance");
    } else {
      assert(extractPatchVersion("", url.toString()) === page.version,
        `patch ${page.version} does not match its Riot source URL`);
    }
  } else {
    const urlVersion = extractPatchVersion("", url.toString());
    if (urlVersion !== page.version) {
      const article = extractPatchArticleMetadata(await readFile(cacheFile, "utf8"));
      assert(normalizeArticleUrl(article.url) === normalizeArticleUrl(url.toString()),
        `patch ${page.version} cached article URL differs from its audited source URL`);
      assert(extractPatchVersion(article.title, "") === page.version,
        `patch ${page.version} does not match its source URL or Riot article title`);
    }
  }
}

function archivePagesForLocale(report, locale, manifest) {
  if (locale === "en-us") {
    return [
      ...(Array.isArray(report.riotEnPages) ? report.riotEnPages : []),
      ...(Array.isArray(report.riotDirectFallbackPages) ? report.riotDirectFallbackPages : [])
        .filter((page) => page.locale === locale),
    ];
  }

  if (locale !== "ru-ru") throw new TypeError(`Unsupported patch-note archive locale: ${locale}`);
  const pages = Array.isArray(report.riotRuPages) ? report.riotRuPages : [];
  const indexCounts = report.sourceIndexes?.riotRu;
  const summary = report.riot?.[locale];
  assert(indexCounts?.count === pages.length && indexCounts?.uniqueVersions === pages.length,
    "Russian Riot index counts do not match cached pages");
  assert(summary?.indexed === pages.length && summary?.parsed === pages.length && summary?.failed === 0,
    "Russian Riot index contains unparsed pages");

  const englishVersions = new Set(manifest.versions.map(({ version }) => version));
  return pages.filter((page) => englishVersions.has(page.version));
}

/**
 * Load only source HTML from a completed audit cache. The cache is never treated
 * as valid merely because a file exists: the audit report and source URL must
 * pass the same archive validation used by reverse replay.
 */
export async function loadValidatedRiotPatchArchiveItems({
  reportPath,
  cacheRoot,
  locale,
  requestedVersions = [],
}) {
  const realRoot = await realpath(cacheRoot);
  const realReportPath = await realpath(reportPath);
  assert(isInside(realRoot, realReportPath), "audit report is outside the ignored audit cache");

  let report;
  try { report = JSON.parse(await readFile(realReportPath, "utf8")); }
  catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid cached Riot patch archive report: ${error.message}`, { cause: error });
    }
    throw error;
  }

  const manifest = buildValidatedRiotPatchArchiveManifest(report);
  const manifestUrls = new Map(manifest.versions.map(({ version, url }) => [version, url]));
  const requested = new Set((Array.isArray(requestedVersions) ? requestedVersions : [requestedVersions])
    .filter((version) => version != null && String(version).trim())
    .map((version) => String(version).trim().toLowerCase()));
  for (const version of requested) assert(isValidPatchVersion(version), `requested patch ${version} is invalid`);

  const pages = archivePagesForLocale(report, locale, manifest);
  const byVersion = new Map();
  for (const page of pages) {
    if (requested.size && !requested.has(page.version)) continue;
    const cacheFile = await resolveCacheFile(cacheRoot, page.cacheFile);
    await assertRiotPage(page, locale, manifestUrls, cacheFile);
    assert(!byVersion.has(page.version), `duplicate cached article for ${locale} patch ${page.version}`);
    byVersion.set(page.version, {
      version: page.version,
      locale,
      title: page.title || (locale === "ru-ru"
        ? `Описание обновления ${page.version} для Wild Rift`
        : `Wild Rift Patch Notes ${page.version}`),
      description: page.description || "",
      url: page.url,
      publishedAt: page.publishedAt || null,
      imageUrl: page.imageUrl || null,
      auditedArchive: {
        cacheFile,
        sourceUrl: page.url,
        sourceAlias: page.sourceAlias || null,
      },
    });
  }

  return [...byVersion.values()].sort((left, right) => comparePatchVersions(right.version, left.version));
}
