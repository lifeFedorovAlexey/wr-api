import "dotenv/config";
import fs from "node:fs/promises";
import { createOllamaRuntime, describeError } from "./ollama-runtime.mjs";
import { parseAssistantTipResponse } from "./assistant-tip-parser.mjs";
import { runInferenceWithRecovery } from "./assistant-retry.mjs";
import { requireAcceptedCount } from "./assistant-sync-contract.mjs";
import { parseWorkflowConfig, renderPrompt } from "./assistant-workflow-config.mjs";

const apiOrigin = String(process.env.WR_API_ORIGIN || "http://127.0.0.1:3002").replace(/\/$/, "");
const ollamaOrigin = String(process.env.OLLAMA_ORIGIN || "http://127.0.0.1:11434").replace(/\/$/, "");
const rawWorkflowConfig = process.env.REPKA_JOB_CONFIG_JSON || "";
const workflowConfig = parseWorkflowConfig(rawWorkflowConfig || JSON.stringify({ ollama: { model: process.env.OLLAMA_MODEL || "qwen3:8b" } }));
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const provider = arg('--provider', 'ollama');
if (!['ollama', 'lmstudio'].includes(provider)) throw new Error('Unknown inference provider');
const model = arg('--model', workflowConfig.ollama.model);
const lmOrigin = arg('--origin', 'http://127.0.0.1:1234');
const event = (type, data) => console.log(`[assistant-event] ${JSON.stringify({ type, ...data })}`);
const slugArgIndex = process.argv.indexOf("--slug");
const requestedSlug = slugArgIndex >= 0 ? String(process.argv[slugArgIndex + 1] || "").trim().toLowerCase() : "";
const dryRun = process.argv.includes("--dry-run");
const ollamaAutoStart = process.env.OLLAMA_AUTO_START !== "false";
const secret = process.env.GUIDES_SYNC_SECRET;
if (!secret) throw new Error("GUIDES_SYNC_SECRET is required");
const ollamaRuntime = createOllamaRuntime({ origin: ollamaOrigin, executable: process.env.OLLAMA_EXE });
const tipSelectionFormat = {
  type: "object",
  properties: { tipIndex: { anyOf: [{ type: "integer" }, { type: "null" }] } },
  required: ["tipIndex"],
  additionalProperties: false,
};

async function api(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { ...options, signal: AbortSignal.timeout(30000), headers: { "content-type": "application/json", "x-guides-sync-secret": secret, ...options.headers } });
  if (!response.ok) throw new Error(`Assistant API ${response.status}`);
  return response.json();
}

function prompt(task, rank, stats) {
  return renderPrompt(workflowConfig.assistant.userPromptTemplate, {
    championName: task.championName,
    championSlug: task.championSlug,
    lane: task.lane,
    rank,
    stableTips: task.stableTips,
    stats,
  });
}

async function generate(task, rank, stats) {
  if (provider === 'lmstudio') {
    const response = await fetch(`${lmOrigin}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model, reasoning_effort: 'none', stream: false, max_tokens: 128,
        temperature: workflowConfig.ollama.temperature,
        messages: [{ role: 'system', content: workflowConfig.assistant.systemPrompt }, { role: 'user', content: prompt(task, rank, stats) }],
        response_format: { type: 'json_schema', json_schema: { name: 'tip_selection', strict: true, schema: tipSelectionFormat } } }),
    });
    if (!response.ok) throw new Error(`LM Studio HTTP ${response.status}`);
    const payload = await response.json();
    const choice = payload.choices?.[0];
    if (choice?.finish_reason !== 'stop' || payload.model !== model) throw new Error('LM Studio returned an incomplete answer or a different model');
    const parsed = JSON.parse(choice.message.content);
    if (!Object.hasOwn(parsed, 'tipIndex') || (parsed.tipIndex !== null && !Number.isInteger(parsed.tipIndex))) throw new Error('Invalid tip selection');
    return { tipIndex: parsed.tipIndex, actualModel: arg('--model-key', payload.model) };
  }
  let response;
  try {
    response = await fetch(`${ollamaOrigin}/api/chat`, {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: workflowConfig.assistant.systemPrompt },
          { role: "user", content: prompt(task, rank, stats) },
        ],
        stream: false,
        think: workflowConfig.ollama.think,
        format: tipSelectionFormat,
        options: {
          temperature: workflowConfig.ollama.temperature,
          top_p: workflowConfig.ollama.topP,
          num_predict: workflowConfig.ollama.numPredict,
        },
      }),
    });
  } catch (error) {
    const wrapped = new Error(`Ollama fetch ${ollamaOrigin}/api/chat failed: ${describeError(error)}`, { cause: error });
    wrapped.code = "OLLAMA_FETCH_FAILED";
    throw wrapped;
  }
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const parsed = parseAssistantTipResponse(payload);
  return {
    ...parsed,
    actualModel: typeof payload?.model === "string" && payload.model.trim() ? payload.model.trim() : null,
  };
}

async function generateComplete(task, rank, stats) {
  const result = await runInferenceWithRecovery({
    retries: workflowConfig.assistant.retries,
    autoStart: provider === 'ollama' && ollamaAutoStart,
    attempt: async () => {
      const payload = await generate(task, rank, stats);
      if (payload.tipIndex == null) return { tipIndex: null, actualModel: payload.actualModel };
      const tipIndex = Number(payload.tipIndex);
      if (Number.isInteger(tipIndex) && task.stableTips?.[tipIndex]) return { tipIndex, actualModel: payload.actualModel };
      return null;
    },
    ensureAvailable: () => ollamaRuntime.ensureAvailable(),
    onRecovery: async () => {
      if (!ollamaRecoveryLogged) {
        ollamaRecoveryLogged = true;
        console.error(`[assistant] Ollama unavailable; attempting auto-start`);
      }
    },
  });
  if (!result) throw new Error('No valid tip selection after all retries');
  return result;
}

function formatMetric(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2).replace(".", ",") : "нет данных";
}

function getVerdict(value) {
  const winRate = Number(value);
  return winRate >= 52 ? "сильный выбор"
    : winRate >= 50.5 ? "средний выбор"
      : winRate >= 49 ? "ситуативный выбор"
        : "слабый выбор";
}

function buildAssessment(task, stats) {
  const verdict = getVerdict(stats.winRate);
  return `${task.championName} — ${verdict}: ${formatMetric(stats.winRate)}% WR при ${formatMetric(stats.pickRate)}% PR и ${formatMetric(stats.banRate)}% BR.`;
}

function buildAdvice(stats) {
  const verdict = getVerdict(stats.winRate);
  const banRate = Number(stats.banRate);
  const pickRate = Number(stats.pickRate);
  if (verdict === "слабый выбор") return "Не бери вслепую: выбирай только при уверенной игре на чемпионе.";
  if (verdict === "ситуативный выбор") return "Выбор рабочий, но статистического перевеса нет — полагайся на свой опыт.";
  if (banRate >= 15) return "Можно ставить в приоритет, но подготовь замену из-за высокого банрейта.";
  if (pickRate < 2) return "Результат сильный, но выбор редкий — относись к цифрам осторожно.";
  return "Можно ставить в приоритет, если чемпион входит в твой уверенный пул.";
}

const statsContextFile = String(process.env.REPKA_STATS_CONTEXT_FILE || '').trim();
const bundle = statsContextFile ? JSON.parse(await fs.readFile(statsContextFile, 'utf8')) : await api("/api/assistant/tasks");
const inputSelection = workflowConfig.input || {};
const selectedChampions = new Set((inputSelection.championIds || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean));
const selectedLanes = new Set((inputSelection.laneIds || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean));
const selectedRanks = new Set((inputSelection.rankIds || []).map((value) => String(value).trim().toLowerCase()).filter(Boolean));
if (requestedSlug) bundle.tasks = bundle.tasks.filter(task => task.championSlug === requestedSlug);
if (inputSelection.scope === "selected") bundle.tasks = bundle.tasks.filter((task) => selectedChampions.has(String(task.championSlug || '').toLowerCase()) || selectedChampions.has(String(task.championName || '').toLowerCase()));
if (selectedLanes.size) bundle.tasks = bundle.tasks.filter((task) => selectedLanes.has(String(task.lane || '').toLowerCase()));
if (selectedRanks.size) bundle.tasks = bundle.tasks.map((task) => ({ ...task, statsByRank: Object.fromEntries(Object.entries(task.statsByRank || {}).filter(([rank]) => selectedRanks.has(String(rank).toLowerCase()))) })).filter((task) => Object.keys(task.statsByRank || {}).length);
const totalChampions = bundle.tasks.length;
const totalRanks = bundle.tasks.reduce((total, task) => total + Object.keys(task.statsByRank || {}).length, 0);
if (!totalRanks) throw new Error('No assistant tasks in the selected snapshot');
const results = [];
let completedChampions = 0;
let completedRanks = 0;
let failedRanks = 0;
let syncedItems = 0;
let ollamaRecoveryLogged = false;
console.log(`[assistant] start champions=${totalChampions} ranks=${totalRanks}`);
console.log(`[assistant] model requested=${model}`);
event('start', { total: totalRanks, snapshotId: bundle.snapshotId, statsDate: bundle.statsDate, model, provider });

async function flush() {
  if (!results.length) return;
  const items = results.splice(0, results.length);
  if (dryRun || workflowConfig.sync?.enabled === false || workflowConfig.sync?.mode === 'preview') {
    for (const item of items) console.log(`[preview] ${item.championSlug} ${item.lane} ${item.rank}: ${item.response}`);
    return;
  }
  const payload = await api("/api/assistant/sync", { method: "POST", body: JSON.stringify({ items }) });
  syncedItems += requireAcceptedCount(payload, items.length, "assistant sync");
  event('sync', { accepted: syncedItems });
}

for (const [index, task] of bundle.tasks.entries()) {
  const ranks = Object.entries(task.statsByRank || {});
  let taskFailed = false;
  for (const [rank, stats] of ranks) {
    try {
      const generated = task.stableTips?.length ? await generateComplete(task, rank, stats) : null;
      const tipIndex = generated?.tipIndex ?? null;
      const actualModel = generated?.actualModel || null;
      const stableTip = tipIndex == null ? "" : ` ${task.stableTips[tipIndex].text}`;
      const response = `${buildAssessment(task, stats)} ${buildAdvice(stats)}${stableTip}`;
      results.push({ championSlug: task.championSlug, lane: task.lane, rank, response, statsSnapshotId: bundle.snapshotId, loreContentHash: task.lore.contentHash, model: actualModel || "unverified", requestedModel: model, actualModel });
      console.log(`[assistant-result] ${JSON.stringify({ championSlug: task.championSlug, championName: task.championName, lane: task.lane, rank, tipIndex, response, statsSnapshotId: bundle.snapshotId, loreContentHash: task.lore.contentHash, model: actualModel || "unverified", requestedModel: model, actualModel })}`);
      completedRanks += 1;
      event('progress', { generated: completedRanks, failed: failedRanks, champion: task.championSlug, rank });
    } catch (error) {
      failedRanks += 1;
      taskFailed = true;
      console.error(`[assistant] failed ${task.championSlug} ${task.lane} ${rank}:`, error.message);
    }
  }
  if (!taskFailed) completedChampions += 1;
  const processed = index + 1;
  if (processed === 1 || processed % 10 === 0 || processed === totalChampions) {
    console.log(`[assistant] progress champions=${processed}/${totalChampions} ranks=${completedRanks}/${totalRanks} failed=${failedRanks}`);
  }
  if (results.length >= 100) await flush();
}
await flush();
event('done', { total: totalRanks, generated: completedRanks, failed: failedRanks, accepted: syncedItems, productionSync: !dryRun && workflowConfig.sync?.enabled !== false && workflowConfig.sync?.mode !== 'preview' });
console.log(`[assistant] done champions=${completedChampions}/${totalChampions} ranks=${completedRanks}/${totalRanks} failed=${failedRanks} synced=${syncedItems}`);
if (failedRanks > 0) process.exitCode = 1;
