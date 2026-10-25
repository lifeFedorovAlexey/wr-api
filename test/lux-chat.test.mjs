import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { luxConfig } from "../lib/lux/config.mjs";
import { createLuxProvider, estimateTokens } from "../lib/lux/provider.mjs";
import { prepareLuxContext, LUX_PROMPT } from "../lib/lux/context.mjs";
import { resolveLuxQuery } from "../lib/lux/knowledge.mjs";
import { createLuxService, validateLuxMessage } from "../lib/lux/service.mjs";

const config = luxConfig({ LUX_ENABLED: "true", LUX_LM_STUDIO_MODEL: "local-model" });
test("Lux config is opt-in outside dev, explicit disable wins, endpoint is server configured", () => {
  assert.equal(luxConfig({}).enabled, false);
  assert.equal(luxConfig({ WR_LOCAL_DEV: "true" }).enabled, true);
  assert.equal(luxConfig({ WR_LOCAL_DEV: "true", LUX_ENABLED: "false" }).enabled, false);
  for (const url of ["file:///secret", "https://user:secret@host/v1", "https://host/v1?override=x"]) assert.throws(() => luxConfig({ LUX_LM_STUDIO_URL: url }));
  assert.equal(luxConfig({ LUX_TIMEOUT_MS: "-1" }).timeoutMs, 60000);
});

test("provider uses LM Studio chat completions, strips thinking and does not expose HTTP errors", async () => {
  let sent;
  const provider = createLuxProvider(config, async (url, init) => {
    assert.equal(url, "http://127.0.0.1:1234/v1/chat/completions");
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "<think>internal</think>Привет!" } }] }) };
  });
  assert.equal(await provider.complete([{ role: "user", content: "Привет" }]), "Привет!");
  assert.equal(sent.model, "local-model"); assert.equal(sent.stream, false);
  await assert.rejects(createLuxProvider(config, async () => ({ ok: false, status: 401 })).complete([]), /lux_unavailable/);
  await assert.rejects(provider.complete([{ role: "user", content: "я".repeat(config.contextTokens+1000) }]), /lux_context_full/);
});

test("automatic model selection refuses ambiguity instead of picking an embedding or arbitrary model", async () => {
  const provider = createLuxProvider({ ...config, model: "" }, async () => ({ ok: true, json: async () => ({ data: [{ id: "a" }, { id: "b" }] }) }));
  await assert.rejects(provider.complete([]), /lux_model_required/);
});

test("query resolves Cyrillic names, current lane/rank override memory, names do not match substrings", () => {
  const catalog = [{ slug: "lux", nameLocalizations: { ru_ru: "Люкс", en_us: "Lux" } }, { slug: "vi", nameLocalizations: { ru_ru: "Вай", en_us: "Vi" } }];
  const query = resolveLuxQuery("Люкс на мид в мастере", catalog, "саппорт diamond");
  assert.deepEqual(query.entities, ["lux"]); assert.equal(query.lane, "mid"); assert.equal(query.rank, "masterPlus");
  assert.deepEqual(resolveLuxQuery("совет по vitality", catalog).entities, []);
  assert.equal(resolveLuxQuery("а кого ещё?", catalog, "поддержка алмаз").lane, "support");
  assert.equal(resolveLuxQuery("кого пикнуть?", catalog).rank, "diamondPlus");
  assert.equal(resolveLuxQuery("расскажи о Люксе", catalog).entities[0], "lux");
  assert.equal(resolveLuxQuery("а теперь?", catalog, ["теперь алмаз", "ранее мастер"]).rank, "diamondPlus");
});

test("large history is summarized in bounded batches while current exchange and sources remain", async () => {
  const turns = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, body: `Вопрос ${i} ${"а".repeat(700)}`, reply: "б".repeat(700) }));
  let summaries = 0;
  const result = await prepareLuxContext({ memory: { summary: "Играет на миде", through_id: 0 }, turns,
    body: "Кого взять?", knowledge: { stats: [{ win_rate: 52 }] }, recall: [], config,
    provider: { complete: async (messages, options) => { assert.equal(options.summary, true); assert.ok(estimateTokens(messages) < config.contextTokens); summaries++; return "Мид, мастер. Последнее исправление сохранено."; } },
  });
  assert.ok(summaries > 1); assert.ok(result.throughId > 0);
  assert.equal(result.messages.at(-1).content, "Кого взять?");
  assert.ok(result.messages.some(message => message.content === turns.at(-1).reply));
  assert.ok(result.messages[0].content.startsWith(LUX_PROMPT));
  assert.ok(estimateTokens(result.messages) + config.replyTokens < config.contextTokens);
});

test("failed summarization never returns a new memory checkpoint", async () => {
  await assert.rejects(prepareLuxContext({ memory: { summary: "original", through_id: 0 },
    turns: Array.from({ length: 6 }, (_, id) => ({ id, body: "а".repeat(2000), reply: "б".repeat(2000) })),
    body: "вопрос", knowledge: {}, recall: [], config, provider: { complete: async () => { throw new Error("offline"); } },
  }), /offline/);
});

test("input requires stable idempotency key and bounded plain text", () => {
  const requestId = randomUUID();
  assert.equal(validateLuxMessage({ body: " Привет ", requestId }).body, "Привет");
  for (const input of [{ body: "x" }, { body: "", requestId }, { body: "x".repeat(2001), requestId }, { body: {}, requestId }]) assert.throws(() => validateLuxMessage(input));
});

test("worker keeps user ownership through retrieval and persistence; failed generation keeps history retryable", async () => {
  const calls = [];
  const claim = { memory: { through_id: 4 }, turns: [], turn: { body: "Люкс?" }, token: "lease" };
  const store = {
    claim: async (userId) => { calls.push(["claim", userId]); return claim; },
    recall: async (userId) => { calls.push(["recall", userId]); return []; },
    finish: async (userId, _claim, result) => { calls.push(["finish", userId]); assert.equal(result.reply, "Привет!"); },
    fail: async (userId, _claim, code) => { calls.push(["fail", userId, code]); },
  };
  let fails = false;
  const service = createLuxService({ store, config, loadKnowledge: async () => ({ knowledge: {}, sources: [], entities: [] }),
    provider: { complete: async () => { if (fails) throw new Error("PRIVATE URL SECRET"); return "Привет!"; } } });
  await service.send(42, { body: "Люкс?", requestId: randomUUID(), userId: 999 }); await service.drain();
  assert.deepEqual(calls, [["claim", 42], ["recall", 42], ["finish", 42]]);
  fails = true; await service.send(42, { body: "Люкс?", requestId: randomUUID() }); await service.drain();
  assert.deepEqual(calls.at(-1), ["fail", 42, "lux_unavailable"]);
});
