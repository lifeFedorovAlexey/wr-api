import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(new URL("../.github/workflows/scrape-fallback.yml", import.meta.url), "utf8").replaceAll("\r", "");

test("automatic workflows have only coordinated fallback; force is an explicit manual choice", () => {
  for (const name of ["sync-all-data", "sync-patch-notes"]) {
    const caller = fs.readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    assert.match(caller, /force:\s*\n\s*description:[^\n]*\n\s*type: boolean\s*\n\s*default: false/);
    assert.match(caller, /force: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.force \}\}/);
    assert.doesNotMatch(caller, /vars\.|KOLVRT_|workflow_run|source-revisions|\n  sync:/);
    assert.equal((caller.match(/cron:/g) || []).length, 1);
  }
  assert.doesNotMatch(workflow, /vars\.|KOLVRT_|expected_api_sha|source-revisions|steps\.revisions/);
});

test("a selective import cannot bypass the freshness guard without explicit force", () => {
  const script = fileURLToPath(new URL("../scripts/scrape-worker.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--executor", "github", "--fallback", "--jobs", "stats", "--slugs", "ahri"], {
    env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8", timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Slugs require an explicit manual run/);
});

test("the actual workflow command preserves fallback and adds force only when requested", { skip: process.platform === "win32" }, () => {
  const block = workflow.slice(workflow.indexOf("- name: Run only due jobs")).match(/run: \|\n([\s\S]*)$/)[1];
  const script = block.split("\n").map(line => line.slice(10)).join("\n");
  const capture = 'function node() { printf "%s\\n" "$@"; }\n';
  for (const force of ["false", "true"]) {
    const result = spawnSync("bash", ["-c", capture + script], {
      env: { ...process.env, SCRAPE_FORCE: force, SCRAPE_SLUGS: "ahri akali", SCRAPE_JOBS: "stats" },
      encoding: "utf8", timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), ["scripts/scrape-worker.mjs", "--executor", "github", "--fallback", "--jobs", "stats", "--slugs", "ahri akali", ...(force === "true" ? ["--force"] : [])]);
  }
});
