import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("only failed patch retries with unchanged parsed data may use cloud metadata", () => {
  const file = fileURLToPath(new URL("../ops/wildrift-worker/cutover-database.py", import.meta.url));
  const py = `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('cutover',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
p=json.load(sys.stdin)
try: m.validate_patch_baseline(p['base'],p['target']); print('accepted')
except RuntimeError: print('rejected')
`;
  const original = { key: ["7.3f", "en-us"], status: "parsed", structuredHash: "original-data", fullHash: "original-metadata" };
  const cases = [
    [[original], "accepted"],
    [[{ ...original, status: "failed", fullHash: "refetched-html" }], "accepted"],
    [[{ ...original, status: "failed", structuredHash: "modified-data" }], "rejected"],
    [[{ ...original, status: "parsed", fullHash: "successful-local-edit" }], "rejected"],
    [[], "rejected"],
    [[original, { ...original, key: ["new-version", "en-us"] }], "rejected"],
  ];
  for (const [target, expected] of cases) {
    const result = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", py, file], { input: JSON.stringify({ base: [original], target }), encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  }
});
