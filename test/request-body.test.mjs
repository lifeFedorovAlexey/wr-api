import test from "node:test";
import assert from "node:assert/strict";

import { readJsonBody } from "../api/utils/request-body.js";

function makeRequest({ method = "POST", headers = {}, chunks = [] } = {}) {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    },
  };
}

test("readJsonBody parses valid JSON payloads", async () => {
  const req = makeRequest({
    chunks: ['{"ok":true,"count":2}'],
  });

  const body = await readJsonBody(req, { maxBytes: 1024 });
  assert.deepEqual(body, { ok: true, count: 2 });
});

test("readJsonBody rejects requests that exceed content-length limit", async () => {
  const req = makeRequest({
    headers: { "content-length": "2048" },
    chunks: [],
  });

  await assert.rejects(
    () => readJsonBody(req, { maxBytes: 1024 }),
    (error) => error?.statusCode === 413,
  );
});

test("readJsonBody rejects requests that exceed streaming byte limit", async () => {
  const req = makeRequest({
    chunks: [Buffer.alloc(900, "a"), Buffer.alloc(200, "b")],
  });

  await assert.rejects(
    () => readJsonBody(req, { maxBytes: 1024 }),
    (error) => error?.statusCode === 413,
  );
});
