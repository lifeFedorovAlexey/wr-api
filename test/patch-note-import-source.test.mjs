import test from "node:test";
import assert from "node:assert/strict";

import { resolvePatchImportSource } from "../lib/patchNoteImportSource.mjs";

const archived = {
  raw_html: "<article>saved source</article>",
  content_hash: "saved-hash",
  parser_version: 4,
  parse_status: "parsed",
};

test("explicitly requested old patch reparses its saved article without fetching", () => {
  assert.deepEqual(resolvePatchImportSource({
    stored: archived,
    parserVersion: 4,
    reparse: true,
  }), {
    action: "parse-archive",
    html: archived.raw_html,
    contentHash: archived.content_hash,
  });
});

test("normal sync skips a current parsed article", () => {
  assert.deepEqual(resolvePatchImportSource({ stored: archived, parserVersion: 4 }), { action: "skip" });
});

test("forced refresh cannot overwrite a successful newer parser result", () => {
  assert.deepEqual(resolvePatchImportSource({
    stored: { ...archived, parser_version: 133 },
    parserVersion: 132,
    reparse: true,
    refreshSource: true,
  }), { action: "skip" });
});

test("stale parser reparses archived source", () => {
  assert.deepEqual(resolvePatchImportSource({ stored: archived, parserVersion: 5 }), {
    action: "parse-archive",
    html: archived.raw_html,
    contentHash: archived.content_hash,
  });
});

test("source refresh explicitly fetches even when an archive exists", () => {
  assert.deepEqual(resolvePatchImportSource({ stored: archived, parserVersion: 4, refreshSource: true }), {
    action: "fetch",
  });
});

test("missing archived source fetches once and can then be archived", () => {
  assert.deepEqual(resolvePatchImportSource({ stored: null, parserVersion: 4, reparse: true }), {
    action: "fetch",
  });
});

test("offline mode fails closed when no source archive exists", () => {
  assert.deepEqual(resolvePatchImportSource({
    stored: null,
    parserVersion: 4,
    reparse: true,
    offline: true,
  }), { action: "missing-archive" });
});

test("an audited local Riot cache is an archive source even when offline", () => {
  const auditedArchive = {
    cacheFile: "D:/workspace/.patch-audit/live-index/riot/direct/0.0-beta.html",
    sourceUrl: "https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-closed-beta-patch-notes",
    sourceAlias: { kind: "riot-closed-beta", patchVersion: "0.0-beta" },
  };

  assert.deepEqual(resolvePatchImportSource({
    stored: null,
    parserVersion: 4,
    auditedArchive,
    offline: true,
  }), {
    action: "parse-audited-archive",
    cacheFile: auditedArchive.cacheFile,
    sourceUrl: auditedArchive.sourceUrl,
    sourceAlias: auditedArchive.sourceAlias,
  });
});

test("stored raw HTML remains preferred over a separately audited cache", () => {
  assert.deepEqual(resolvePatchImportSource({
    stored: archived,
    parserVersion: 5,
    auditedArchive: { cacheFile: "archive.html", sourceUrl: "https://example.test/patch" },
  }), {
    action: "parse-archive",
    html: archived.raw_html,
    contentHash: archived.content_hash,
  });
});

test("explicit source refresh bypasses the audited cache", () => {
  assert.deepEqual(resolvePatchImportSource({
    stored: null,
    parserVersion: 4,
    auditedArchive: { cacheFile: "archive.html", sourceUrl: "https://example.test/patch" },
    refreshSource: true,
    offline: true,
  }), { action: "missing-archive" });
});
