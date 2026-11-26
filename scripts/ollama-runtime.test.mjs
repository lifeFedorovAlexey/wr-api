import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createOllamaRuntime } from "./ollama-runtime.mjs";

function response(status = 200) {
  return { ok: status >= 200 && status < 300, status };
}

test("does not start Ollama when the API is already available", async () => {
  let probes = 0;
  let starts = 0;
  const runtime = createOllamaRuntime({
    origin: "http://127.0.0.1:11434",
    platform: "win32",
    fetchImpl: async () => { probes += 1; return response(); },
    spawnImpl: () => { starts += 1; throw new Error("must not start"); },
    sleep: async () => {},
  });

  await runtime.ensureAvailable();

  assert.equal(probes, 1);
  assert.equal(starts, 0);
});

test("starts Ollama after connection failure and waits until it is ready", async () => {
  let probes = 0;
  let command = null;
  const runtime = createOllamaRuntime({
    origin: "http://127.0.0.1:11434",
    executable: "C:\\Ollama\\ollama.exe",
    platform: "win32",
    fetchImpl: async () => {
      probes += 1;
      if (probes === 1) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      return response();
    },
    spawnImpl: (exe, args) => {
      command = { exe, args };
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
    sleep: async () => {},
    maxWaitAttempts: 2,
  });

  await runtime.ensureAvailable();

  assert.deepEqual(command, { exe: "C:\\Ollama\\ollama.exe", args: ["serve"] });
  assert.equal(probes, 2);
});

test("reports a clear error when Ollama cannot be started", async () => {
  const runtime = createOllamaRuntime({
    origin: "http://127.0.0.1:11434",
    executable: "C:\\missing\\ollama.exe",
    platform: "win32",
    fetchImpl: async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); },
    spawnImpl: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn failed"), { code: "ENOENT" })));
      return child;
    },
  });

  await assert.rejects(runtime.ensureAvailable(), /Error: spawn failed/);
});

test("starts Docker Desktop and the Ollama container when Docker Engine is down", async () => {
  let probes = 0;
  const calls = [];
  let infoAttempts = 0;
  const runtime = createOllamaRuntime({
    origin: "http://127.0.0.1:11434",
    platform: "win32",
    env: {},
    fetchImpl: async () => {
      probes += 1;
      if (probes === 1) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      return response();
    },
    spawnImpl: (exe, args) => {
      calls.push({ exe, args });
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => {
        child.emit("spawn");
        if (args[0] === "info") {
          infoAttempts += 1;
          child.emit("close", infoAttempts === 1 ? 1 : 0);
        } else if (args[0] === "start") {
          child.emit("close", 0);
        }
      });
      return child;
    },
    sleep: async () => {},
    maxWaitAttempts: 2,
  });

  await runtime.ensureAvailable();

  assert.deepEqual(calls, [
    { exe: "docker.exe", args: ["info"] },
    { exe: "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe", args: [] },
    { exe: "docker.exe", args: ["info"] },
    { exe: "docker.exe", args: ["start", "ollama"] },
  ]);
  assert.equal(probes, 2);
});
