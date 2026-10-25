import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runPatchNotesImport } from "../lib/patchNotesImport.mjs";

const log = { log() {}, error() {} };

test("one failed article fails the import after remaining English and Russian articles are processed", async () => {
  const visited = [], recorded = [];
  await assert.rejects(runPatchNotesImport({
    loadIndex: async () => [{ version: "7.3c" }, { version: "7.3b" }, { version: "7.3a" }],
    loadReadyEnglish: async () => ["7.3a"],
    importPatch: async (item, locale) => {
      visited.push(`${locale}:${item.version}`);
      if (locale === "en-us" && item.version === "7.3c") return "failed";
      if (locale === "en-us" && item.version === "7.3b") throw new Error("article download failed");
      return "parsed";
    },
    markFailed: async (locale, version) => recorded.push(`${locale}:${version}`),
    log,
  }), /2 article\(s\) failed \(en-us 7\.3c, en-us 7\.3b\)/);
  assert.deepEqual(visited, ["en-us:7.3c", "en-us:7.3b", "en-us:7.3a", "ru-ru:7.3a"]);
  assert.deepEqual(recorded, ["en-us:7.3b"]);
});

test("already current articles and an absent translation are successful checks", async () => {
  await runPatchNotesImport({
    loadIndex: async locale => locale === "en-us" ? [{ version: "7.3c" }] : [],
    loadReadyEnglish: async () => ["7.3c"],
    importPatch: async () => "skipped",
    markFailed: async () => assert.fail("No failure expected"),
    log,
  });
});

test("a failed Russian article makes the importer process exit nonzero", () => {
  const moduleUrl = new URL("../lib/patchNotesImport.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { runPatchNotesImport } from ${JSON.stringify(moduleUrl)};
    await runPatchNotesImport({
      loadIndex: async () => [{ version: "7.3c" }],
      loadReadyEnglish: async () => ["7.3c"],
      importPatch: async (item, locale) => locale === "ru-ru" ? "failed" : "parsed",
      markFailed: async () => {},
      log: { log() {}, error() {} },
    });
  `], { encoding: "utf8", timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /article\(s\) failed \(ru-ru 7\.3c\)/);
});

test("archived versions are imported alongside the index without hiding an archived article failure", async () => {
  const visited = [];
  await assert.rejects(runPatchNotesImport({
    loadIndex: async locale => locale === "en-us" ? [{ version: "9.0", url: "current-index" }] : [],
    loadArchived: async locale => locale === "en-us"
      ? [{ version: "9.0", url: "old-index" }, { version: "3.4", url: "archived-source" }]
      : [{ version: "3.4", url: "archived-translation" }],
    loadReadyEnglish: async () => ["3.4"],
    importPatch: async (item, locale, options) => {
      visited.push({ locale, version: item.version, url: item.url, force: options.force });
      return locale === "en-us" && item.version === "3.4" ? "failed" : "parsed";
    },
    markFailed: async () => assert.fail("Returned parse failures are already recorded"),
    log,
  }), /article\(s\) failed \(en-us 3\.4\)/);
  assert.deepEqual(visited, [
    { locale: "en-us", version: "9.0", url: "current-index", force: true },
    { locale: "en-us", version: "3.4", url: "archived-source", force: false },
    { locale: "ru-ru", version: "3.4", url: "archived-translation", force: false },
  ]);
});

test("explicit patch requests refresh every requested article and do not fetch unrelated indexes", async () => {
  const visited = [];
  await runPatchNotesImport({
    requestedVersions: ["3.4a", "3.4b", "3.4a"],
    loadIndex: async () => assert.fail("Explicit requests do not need an index"),
    loadArchived: async () => assert.fail("Explicit requests do not load all archived versions"),
    loadReadyEnglish: async () => ["3.4a", "3.4b", "9.0"],
    importPatch: async (item, locale, options) => {
      assert.equal(options.force, true);
      assert.match(item.url, /wild-rift-patch-notes-3-4[ab]\/$/);
      visited.push(`${locale}:${item.version}`);
      return "parsed";
    },
    markFailed: async () => assert.fail("No failure expected"),
    log,
  });
  assert.deepEqual(visited, ["en-us:3.4a", "en-us:3.4b", "ru-ru:3.4a", "ru-ru:3.4b"]);
});

test("archive reparsing includes current-parser articles without forcing every source download", async () => {
  const visited = [];
  await runPatchNotesImport({
    reparseArchived: true,
    loadIndex: async () => [{ version: "9.0" }],
    loadArchived: async (_locale, options) => {
      assert.equal(options.all, true);
      return [{ version: "3.4" }];
    },
    loadReadyEnglish: async () => ["9.0", "3.4"],
    importPatch: async (item, locale, options) => {
      assert.equal(options.reparse, true);
      assert.equal(options.force, item.version === "9.0");
      visited.push(`${locale}:${item.version}`);
      return "parsed";
    },
    markFailed: async () => assert.fail("No failure expected"),
    log,
  });
  assert.deepEqual(visited, ["en-us:9.0", "en-us:3.4", "ru-ru:9.0", "ru-ru:3.4"]);
});

test("archive-only versions reuse stored HTML when their original URLs are no longer available", async () => {
  const visited = [];
  await runPatchNotesImport({
    loadIndex: async () => [],
    loadArchived: async () => [{ version: "3.4" }, { version: "3.4a" }],
    loadReadyEnglish: async () => ["3.4a", "3.4"],
    importPatch: async (item, locale, options) => {
      if (options.force) throw new Error("Archived source URL now returns HTTP 404");
      visited.push(`${locale}:${item.version}`);
      return "parsed";
    },
    markFailed: async () => assert.fail("Stored HTML must not require an unrelated source refresh"),
    log,
  });
  assert.deepEqual(visited, ["en-us:3.4a", "en-us:3.4", "ru-ru:3.4a", "ru-ru:3.4"]);
});
