import test from "node:test";
import assert from "node:assert/strict";
import { runInferenceWithRecovery } from "./assistant-retry.mjs";

test("successful Ollama recovery does not consume the only inference retry", async () => {
  let attempts = 0;
  let recoveries = 0;
  const result = await runInferenceWithRecovery({
    retries: 1,
    autoStart: true,
    attempt: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("connection refused"), { code: "OLLAMA_FETCH_FAILED" });
      return "generated";
    },
    ensureAvailable: async () => { recoveries += 1; },
  });

  assert.equal(result, "generated");
  assert.equal(attempts, 2);
  assert.equal(recoveries, 1);
});

test("inference failure still respects the configured retry count", async () => {
  let attempts = 0;
  await assert.rejects(runInferenceWithRecovery({
    retries: 1,
    autoStart: false,
    attempt: async () => {
      attempts += 1;
      throw new Error("invalid response");
    },
    ensureAvailable: async () => {},
  }), /invalid response/);
  assert.equal(attempts, 1);
});
