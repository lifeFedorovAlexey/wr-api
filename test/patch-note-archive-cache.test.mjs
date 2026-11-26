import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadValidatedRiotPatchArchiveItems } from "../lib/patchNoteArchiveCache.mjs";

const CLOSED_BETA_URL = "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-closed-beta-patch-notes";

function articleHtml(url, title) {
  return `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { page: {
    url, title, blades: [{ type: "articleMasthead", title }],
  } } } })}</script>`;
}

function makeReport({ root, betaCacheFile, patchCacheFile, patch20CacheFile, ruCacheFile, ru20CacheFile }) {
  const betaAlias = {
    kind: "riot-closed-beta",
    patchVersion: "0.0-beta",
    articleUrl: CLOSED_BETA_URL,
    provenanceUrl: CLOSED_BETA_URL,
  };
  return {
    generatedAt: "2026-10-17T16:21:39.211Z",
    mode: "offline-cache",
    sourceIndexes: {
      riotEn: { count: 2, uniqueVersions: 2 },
      riotRu: { count: 2, uniqueVersions: 2 },
    },
    riot: {
      "en-us": { indexed: 2, parsed: 2, failed: 0 },
      "ru-ru": { indexed: 2, parsed: 2, failed: 0 },
    },
    riotEnPages: [{
      version: "1.1",
      status: "parsed",
      locale: "en-us",
      url: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-1-1",
      cacheFile: patchCacheFile,
    }, {
      version: "2.0",
      status: "parsed",
      locale: "en-us",
      url: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-2-0",
      cacheFile: patch20CacheFile,
    }],
    riotRuPages: [{
      version: "1.1",
      status: "parsed",
      locale: "ru-ru",
      url: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/opisanie-obnovleniya-1-1-dlya-wild-rift",
      cacheFile: ruCacheFile,
    }, {
      version: "2.0",
      status: "parsed",
      locale: "ru-ru",
      url: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-1-2",
      cacheFile: ru20CacheFile,
    }],
    riotDirectFallbackPages: [{
      version: "0.0-beta",
      status: "parsed",
      locale: "en-us",
      url: CLOSED_BETA_URL,
      cacheFile: betaCacheFile,
      sourceAlias: betaAlias,
    }],
    riotDirectFallback: { indexed: 1, parsed: 1, failed: 0 },
    coverage: {
      rpnVersionsNotInRiotEnIndex: ["0.0-beta"],
      rpnVersionsWithoutValidatedRiotSource: [],
    },
  };
}

async function makeCache() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wr-patch-archive-"));
  const cacheRoot = path.join(root, ".patch-audit", "live-index");
  const enRoot = path.join(cacheRoot, "riot");
  await mkdir(path.join(enRoot, "direct"), { recursive: true });
  await mkdir(path.join(enRoot, "en-us"), { recursive: true });
  await mkdir(path.join(enRoot, "ru-ru"), { recursive: true });
  const betaCacheFile = path.join(enRoot, "direct", "0.0-beta.html");
  const patchCacheFile = path.join(enRoot, "en-us", "1.1.html");
  const patch20CacheFile = path.join(enRoot, "en-us", "2.0.html");
  const ruCacheFile = path.join(enRoot, "ru-ru", "1.1.html");
  const ru20CacheFile = path.join(enRoot, "ru-ru", "2.0.html");
  await writeFile(betaCacheFile, articleHtml(CLOSED_BETA_URL, "Wild Rift Closed Beta Patch Notes"), "utf8");
  await writeFile(patchCacheFile, "patch 1.1 article", "utf8");
  await writeFile(patch20CacheFile, "patch 2.0 article", "utf8");
  await writeFile(ruCacheFile, "patch 1.1 Russian article", "utf8");
  const ru20Url = "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-1-2/";
  const ru20Title = "Описание обновления 2.0 для Wild Rift";
  await writeFile(ru20CacheFile, `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { page: {
      url: ru20Url,
      title: ru20Title,
      blades: [{ type: "articleMasthead", title: ru20Title }],
    } } },
  })}</script>`, "utf8");
  const reportPath = path.join(cacheRoot, "audit-report.json");
  return { root, cacheRoot, reportPath, betaCacheFile, patchCacheFile, patch20CacheFile, ruCacheFile, ru20CacheFile };
}

test("loads only audited article paths and preserves a provenance-backed alias", async (t) => {
  const cache = await makeCache();
  t.after(() => rm(cache.root, { recursive: true, force: true }));
  await writeFile(cache.reportPath, JSON.stringify(makeReport(cache)), "utf8");

  const items = await loadValidatedRiotPatchArchiveItems({
    reportPath: cache.reportPath,
    cacheRoot: cache.cacheRoot,
    locale: "en-us",
  });

  assert.deepEqual(items.map(({ version }) => version), ["2.0", "1.1", "0.0-beta"]);
  assert.equal(items[1].auditedArchive.cacheFile, await realpath(cache.patchCacheFile));
  assert.equal(items[2].auditedArchive.cacheFile, await realpath(cache.betaCacheFile));
  assert.equal(items[2].auditedArchive.sourceAlias.kind, "riot-closed-beta");
  assert.equal(items[2].auditedArchive.sourceUrl, CLOSED_BETA_URL);
});

test("filters audited archive pages by requested version without generating route guesses", async (t) => {
  const cache = await makeCache();
  t.after(() => rm(cache.root, { recursive: true, force: true }));
  await writeFile(cache.reportPath, JSON.stringify(makeReport(cache)), "utf8");

  const items = await loadValidatedRiotPatchArchiveItems({
    reportPath: cache.reportPath,
    cacheRoot: cache.cacheRoot,
    locale: "en-us",
    requestedVersions: ["0.0-beta"],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].version, "0.0-beta");
  assert.equal(items[0].url, CLOSED_BETA_URL);
});

test("validates an unnumbered cached article without a version-specific exception", async (t) => {
  const cache = await makeCache();
  t.after(() => rm(cache.root, { recursive: true, force: true }));
  const report = makeReport(cache);
  const version = "9.9z";
  const url = "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-preview-patch-notes";
  const page = report.riotDirectFallbackPages[0];
  page.version = version;
  page.url = url;
  page.sourceAlias = { patchVersion: version, articleUrl: url, provenanceUrl: url };
  report.coverage.rpnVersionsNotInRiotEnIndex = [version];
  await writeFile(cache.betaCacheFile, articleHtml(url, "Wild Rift Preview Patch Notes"));
  await writeFile(cache.reportPath, JSON.stringify(report));
  const options = { reportPath: cache.reportPath, cacheRoot: cache.cacheRoot, locale: "en-us", requestedVersions: [version] };
  const items = await loadValidatedRiotPatchArchiveItems(options);
  assert.equal(items[0].version, version);
  assert.equal(items[0].url, url);
  await writeFile(cache.betaCacheFile, articleHtml(url, "Unrelated Article"));
  await assert.rejects(loadValidatedRiotPatchArchiveItems(options), /source alias does not match/);
  await writeFile(cache.betaCacheFile, articleHtml(url, "Wild Rift Patch Notes 7.3"));
  await assert.rejects(loadValidatedRiotPatchArchiveItems(options), /source alias does not match/);
});

test("accepts Riot's localized Russian route and a validated article title when its legacy URL slug differs", async (t) => {
  const cache = await makeCache();
  t.after(() => rm(cache.root, { recursive: true, force: true }));
  await writeFile(cache.reportPath, JSON.stringify(makeReport(cache)), "utf8");

  const items = await loadValidatedRiotPatchArchiveItems({
    reportPath: cache.reportPath,
    cacheRoot: cache.cacheRoot,
    locale: "ru-ru",
  });

  assert.deepEqual(items.map(({ version }) => version), ["2.0", "1.1"]);
  assert.equal(items[1].auditedArchive.cacheFile, await realpath(cache.ruCacheFile));
  assert.match(items[1].url, /opisanie-obnovleniya-1-1-dlya-wild-rift/u);
  assert.equal(items[0].auditedArchive.cacheFile, await realpath(cache.ru20CacheFile));
  assert.equal(items[0].url, "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-1-2");
});

test("rejects a legacy Russian route when the cached Riot article title identifies a different patch", async (t) => {
  const cache = await makeCache();
  t.after(() => rm(cache.root, { recursive: true, force: true }));
  const report = makeReport(cache);
  const wrongTitle = "Описание обновления 1.2 для Wild Rift";
  await writeFile(cache.ru20CacheFile, `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { page: {
      url: "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-1-2/",
      title: wrongTitle,
      blades: [{ type: "articleMasthead", title: wrongTitle }],
    } } },
  })}</script>`, "utf8");
  await writeFile(cache.reportPath, JSON.stringify(report), "utf8");

  await assert.rejects(loadValidatedRiotPatchArchiveItems({
    reportPath: cache.reportPath,
    cacheRoot: cache.cacheRoot,
    locale: "ru-ru",
  }), /does not match its source URL or Riot article title/u);
});

test("rejects a cache file outside the ignored archive directory", async (t) => {
  const cache = await makeCache();
  t.after(() => rm(cache.root, { recursive: true, force: true }));
  const outsideFile = path.join(cache.root, "outside.html");
  await writeFile(outsideFile, "not part of the archive cache", "utf8");
  await writeFile(cache.reportPath, JSON.stringify(makeReport({ ...cache, betaCacheFile: outsideFile })), "utf8");

  await assert.rejects(loadValidatedRiotPatchArchiveItems({
    reportPath: cache.reportPath,
    cacheRoot: cache.cacheRoot,
    locale: "en-us",
  }), /escapes the ignored audit cache/u);
});

test("rejects an audited entry whose Riot URL differs from the validated manifest", async (t) => {
  const cache = await makeCache();
  t.after(() => rm(cache.root, { recursive: true, force: true }));
  const report = makeReport(cache);
  report.riotEnPages[0].title = "Wild Rift Patch Notes 1.1";
  report.riotEnPages[0].url = "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-1-0";
  await writeFile(cache.reportPath, JSON.stringify(report), "utf8");

  await assert.rejects(loadValidatedRiotPatchArchiveItems({
    reportPath: cache.reportPath,
    cacheRoot: cache.cacheRoot,
    locale: "en-us",
  }), /outside the validated English archive manifest|does not match its Riot source URL/u);
});
