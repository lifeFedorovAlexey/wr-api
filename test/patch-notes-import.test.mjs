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
