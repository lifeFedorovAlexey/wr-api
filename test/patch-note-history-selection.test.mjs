import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { selectPatchHistory } from "../lib/patchNoteHistorySelection.mjs";
import {
  isMissingRussianFallbackArticle,
  resolveRequestedPatchItem,
  selectRequestedPatchItems,
} from "../lib/patchNoteRequestedItems.mjs";

const syncScript = await readFile(new URL("../scripts/sync-patch-notes.mjs", import.meta.url), "utf8");

test("keeps the whole Riot archive index unless a limit is explicitly requested", () => {
  const archive = Array.from({ length: 142 }, (_, index) => ({ version: `patch-${index}` }));

  assert.equal(selectPatchHistory(archive).length, 142);
  assert.equal(selectPatchHistory(archive, undefined).length, 142);
  assert.equal(selectPatchHistory(archive, "").length, 142);
});

test("supports an explicit positive history limit for bounded local runs", () => {
  const archive = Array.from({ length: 8 }, (_, index) => ({ version: `patch-${index}` }));

  assert.deepEqual(selectPatchHistory(archive, "3"), archive.slice(0, 3));
  assert.deepEqual(selectPatchHistory(archive, 20), archive);
});

test("resolves requested patches through their locale index URL before using a generated fallback", () => {
  const requested = selectRequestedPatchItems(
    ["3.2b", "9.9z"],
    [{ version: "3.2b", locale: "ru-ru", url: "https://example.test/opisanie-obnovleniya-3-2b-dlya-wild-rift/" }],
    [],
    "ru-ru",
  );

  assert.equal(requested[0].url, "https://example.test/opisanie-obnovleniya-3-2b-dlya-wild-rift/");
  assert.equal(requested[0].generatedFallbackUrl, undefined);
  assert.equal(requested[1].url, "https://wildrift.leagueoflegends.com/ru-ru/news/game-updates/wild-rift-patch-notes-9-9z/");
  assert.equal(requested[1].generatedFallbackUrl, true);
});

test("treats a missing generated Russian fallback page as an unavailable locale", () => {
  const [item] = selectRequestedPatchItems(["0.5"], [], [], "ru-ru");
  const notFound = Object.assign(new Error("HTTP 404"), { status: 404 });

  assert.equal(isMissingRussianFallbackArticle(item, "ru-ru", notFound), true);
  assert.equal(isMissingRussianFallbackArticle(item, "en-us", notFound), false);
  assert.equal(isMissingRussianFallbackArticle({ ...item, generatedFallbackUrl: false }, "ru-ru", notFound), false);
  assert.equal(isMissingRussianFallbackArticle(item, "ru-ru", Object.assign(new Error("HTTP 500"), { status: 500 })), false);
});

test("marks an uncached requested Russian patch unverified in offline audited-cache mode", () => {
  const [fallback] = selectRequestedPatchItems(["0.0-beta"], [], [], "ru-ru");
  const result = resolveRequestedPatchItem(fallback, {
    locale: "ru-ru",
    offline: true,
    useAuditedArchiveCache: true,
  });

  assert.equal(result.version, "0.0-beta");
  assert.equal(result.generatedFallbackUrl, true);
  assert.equal(result.url, null);
  assert.equal(result.offlineSourceStatus, "unverified-not-cached");
});

test("continues to fetch an uncached Russian fallback online and prefers an audited cache hit offline", () => {
  const [fallback] = selectRequestedPatchItems(["0.0-beta"], [], [], "ru-ru");
  assert.equal(resolveRequestedPatchItem(fallback, {
    locale: "ru-ru",
    offline: false,
    useAuditedArchiveCache: true,
  }).offlineSourceStatus, undefined);

  const audited = { version: "0.0-beta", locale: "ru-ru", url: "https://riot.test/validated", auditedArchive: { cacheFile: "cached.html" } };
  assert.equal(resolveRequestedPatchItem(fallback, {
    auditedArchiveItem: audited,
    locale: "ru-ru",
    offline: true,
    useAuditedArchiveCache: true,
  }), audited);
});

test("rejects invalid explicit history limits instead of silently syncing no patches", () => {
  for (const limit of ["0", "-1", "many", "1.5", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => selectPatchHistory([], limit), /positive safe integer/);
  }
});

test("Riot sync applies only the optional limit and does not truncate the archive by default", () => {
  assert.match(syncScript, /async function loadIndex\(locale, \{ limit = HISTORY_LIMIT \} = \{\}\)/);
  assert.match(syncScript, /selectPatchHistory\(parsePatchIndex\(html, locale\), limit\)/);
  assert.doesNotMatch(syncScript, /PATCH_NOTES_MAX_HISTORY\s*\|\|\s*32/);
});
