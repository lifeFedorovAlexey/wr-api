import test from "node:test";
import assert from "node:assert/strict";
import { parseAssistantTipResponse } from "./assistant-tip-parser.mjs";

test("parses valid JSON from Ollama", () => {
  assert.deepEqual(parseAssistantTipResponse({ response: '{"tipIndex":1}' }), { tipIndex: 1 });
});

test("parses the final tipIndex from gpt-oss reasoning text", () => {
  const payload = {
    response: 'We need to choose. The prompt says tipIndex:0. The better choice is tipIndex 1. Return JSON {":1}',
  };
  assert.deepEqual(parseAssistantTipResponse(payload), { tipIndex: 1 });
});

test("uses thinking when gpt-oss leaves response empty", () => {
  assert.deepEqual(parseAssistantTipResponse({ response: "", thinking: "The selected tipIndex is 0." }), { tipIndex: 0 });
});

test("parses the Ollama chat response shape", () => {
  assert.deepEqual(parseAssistantTipResponse({ message: { content: '{"tipIndex":0}', thinking: "" } }), { tipIndex: 0 });
});

test("rejects an empty or unrelated response", () => {
  assert.throws(() => parseAssistantTipResponse({ response: "No selection" }), /no parseable tipIndex/);
});
