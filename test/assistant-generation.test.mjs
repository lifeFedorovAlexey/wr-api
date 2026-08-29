import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "generate-assistant-responses.mjs");

function startTasksApi() {
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/assistant/tasks") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        snapshotId: 1,
        tasks: [{
          championName: "Amumu",
          championSlug: "amumu",
          lane: "jungle",
          statsByRank: { king: { winRate: 51, pickRate: 3, banRate: 1 } },
          stableTips: [{ text: "Use your engage with follow-up." }],
          lore: { contentHash: "fixture" },
        }],
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/assistant/sync") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ accepted: Array.isArray(payload.items) ? payload.items.length : 0 }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/chat") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ model: "fixture-actual-model", message: { content: '{"tipIndex":0}' } }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  return server;
}

function runGenerator(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`generator timed out\n${output}`));
    }, 10000);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
  });
}

test("generator exits non-zero when an assistant item fails", async (t) => {
  const server = startTasksApi();
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const result = await runGenerator({
    WR_API_ORIGIN: `http://127.0.0.1:${address.port}`,
    OLLAMA_ORIGIN: "http://127.0.0.1:65534",
    OLLAMA_AUTO_START: "false",
    GUIDES_SYNC_SECRET: "test-secret",
  });

  assert.equal(result.signal, null);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /\[assistant\] failed amumu jungle king: Ollama fetch .*ECONNREFUSED/);
  assert.match(result.output, /\[assistant\] done champions=0\/1 ranks=0\/1 failed=1 synced=0/);
});

test("generator records requested and actual Ollama model separately", async (t) => {
  const server = startTasksApi();
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const result = await runGenerator({
    WR_API_ORIGIN: `http://127.0.0.1:${address.port}`,
    OLLAMA_ORIGIN: `http://127.0.0.1:${address.port}`,
    OLLAMA_AUTO_START: "false",
    OLLAMA_MODEL: "fixture-requested-model",
    GUIDES_SYNC_SECRET: "test-secret",
  });

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\[assistant\] model requested=fixture-requested-model/);
  assert.match(result.output, /"requestedModel":"fixture-requested-model"/);
  assert.match(result.output, /"actualModel":"fixture-actual-model"/);
  assert.match(result.output, /"statsSnapshotId":1/);
  assert.match(result.output, /"loreContentHash":"fixture"/);
});

test("generator consumes the worker-owned stats context file", async (t) => {
  const server = startTasksApi();
  t.after(() => server.close());
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const file = path.join(os.tmpdir(), `repka-stats-fixture-${process.pid}.json`);
  await fs.writeFile(file, JSON.stringify({
    source: "wr-api",
    scope: "selected",
    championIds: ["amumu"],
    laneIds: ["jungle"],
    rankIds: ["king"],
    snapshotId: 99,
    tasks: [{ championName: "Amumu", championSlug: "amumu", lane: "jungle", statsByRank: { king: { winRate: 51, pickRate: 3, banRate: 1 } }, stableTips: [{ text: "Use your engage with follow-up." }], lore: { contentHash: "file-fixture" } }],
  }), "utf8");
  t.after(() => fs.rm(file, { force: true }));
  const result = await runGenerator({
    REPKA_STATS_CONTEXT_FILE: file,
    REPKA_JOB_CONFIG_JSON: JSON.stringify({ input: { scope: "selected", championIds: ["amumu"], laneIds: ["jungle"], rankIds: ["king"] }, sync: { enabled: false, mode: "preview" } }),
    WR_API_ORIGIN: "http://127.0.0.1:1",
    OLLAMA_ORIGIN: `http://127.0.0.1:${address.port}`,
    OLLAMA_AUTO_START: "false",
    GUIDES_SYNC_SECRET: "test-secret",
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /"statsSnapshotId":99/);
  assert.match(result.output, /"loreContentHash":"file-fixture"/);
});
