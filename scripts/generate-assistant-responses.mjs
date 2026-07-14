import "dotenv/config";

const apiOrigin = String(process.env.WR_API_ORIGIN || "http://127.0.0.1:3002").replace(/\/$/, "");
const ollamaOrigin = String(process.env.OLLAMA_ORIGIN || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL || "qwen3:8b";
const slugArgIndex = process.argv.indexOf("--slug");
const requestedSlug = slugArgIndex >= 0 ? String(process.argv[slugArgIndex + 1] || "").trim().toLowerCase() : "";
const dryRun = process.argv.includes("--dry-run");
const secret = process.env.GUIDES_SYNC_SECRET;
if (!secret) throw new Error("GUIDES_SYNC_SECRET is required");

async function api(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { ...options, headers: { "content-type": "application/json", "x-guides-sync-secret": secret, ...options.headers } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function prompt(task, rank, stats) {
  return `Выбери один наиболее полезный устойчивый совет для указанной линии и статистического среза. Не переписывай совет и не создавай новый. Верни только JSON {"tipIndex":0}, где tipIndex — индекс в массиве. Если массив пуст, верни {"tipIndex":null}.

Чемпион: ${task.championName} (${task.championSlug})
Линия: ${task.lane}
Ранг: ${rank}
Проверенные советы: ${JSON.stringify(task.stableTips || [])}
Статистика: ${JSON.stringify(stats)}`;
}

async function generate(task, rank, stats) {
  const response = await fetch(`${ollamaOrigin}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: prompt(task, rank, stats), stream: false, format: "json", options: { temperature: 0.45, top_p: 0.85, num_predict: 400 } }),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  return JSON.parse(payload.response);
}

async function generateComplete(task, rank, stats) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const payload = await generate(task, rank, stats);
      if (payload.tipIndex == null) return null;
      const tipIndex = Number(payload.tipIndex);
      if (Number.isInteger(tipIndex) && task.stableTips?.[tipIndex]) return tipIndex;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
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

const bundle = await api("/api/assistant/tasks");
if (requestedSlug) bundle.tasks = bundle.tasks.filter((task) => task.championSlug === requestedSlug);
const results = [];
async function flush() {
  if (!results.length) return;
  const items = results.splice(0, results.length);
  if (dryRun) {
    for (const item of items) console.log(`[dry-run] ${item.championSlug} ${item.lane} ${item.rank}: ${item.response}`);
    return;
  }
  await api("/api/assistant/sync", { method: "POST", body: JSON.stringify({ items }) });
}
let completed = 0;
for (const task of bundle.tasks) {
  let completedRanks = 0;
  for (const [rank, stats] of Object.entries(task.statsByRank)) {
    try {
      const tipIndex = task.stableTips?.length ? await generateComplete(task, rank, stats) : null;
      const stableTip = tipIndex == null ? "" : ` ${task.stableTips[tipIndex].text}`;
      const response = `${buildAssessment(task, stats)} ${buildAdvice(stats)}${stableTip}`;
      results.push({ championSlug: task.championSlug, lane: task.lane, rank, response, statsSnapshotId: bundle.snapshotId, loreContentHash: task.lore.contentHash, model });
      completedRanks += 1;
    } catch (error) {
      console.error(`[assistant] failed ${task.championSlug} ${task.lane} ${rank}:`, error.message);
    }
  }
  if (completedRanks === Object.keys(task.statsByRank).length) {
    completed += 1;
    console.log(`[assistant] ${completed}/${bundle.tasks.length} ${task.championSlug} ${task.lane}`);
  }
  if (results.length >= 100) await flush();
}
await flush();
console.log(`[assistant] done: ${completed}/${bundle.tasks.length}`);
