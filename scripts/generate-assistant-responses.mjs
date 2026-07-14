import "dotenv/config";

const apiOrigin = String(process.env.WR_API_ORIGIN || "http://127.0.0.1:3002").replace(/\/$/, "");
const ollamaOrigin = String(process.env.OLLAMA_ORIGIN || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL || "qwen3:8b";
const slugArgIndex = process.argv.indexOf("--slug");
const requestedSlug = slugArgIndex >= 0 ? String(process.argv[slugArgIndex + 1] || "").trim().toLowerCase() : "";
const secret = process.env.GUIDES_SYNC_SECRET;
if (!secret) throw new Error("GUIDES_SYNC_SECRET is required");

async function api(path, options = {}) {
  const response = await fetch(`${apiOrigin}${path}`, { ...options, headers: { "content-type": "application/json", "x-guides-sync-secret": secret, ...options.headers } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function prompt(task) {
  return `Ты — Люкс из League of Legends и оцениваешь чемпиона Wild Rift по статистике. Для каждого ранга напиши ровно 2 коротких предложения, максимум 300 символов. Первое предложение — прямой практический вердикт и минимум две точные цифры из данных (WR, PR или BR). Второе — рекомендация игроку с одним естественным штрихом характера или биографии чемпиона. Оценка важнее украшений. Не говори о росте, падении или стабильности: передан только один срез. Не называй position лидерством без сравнения. Не выдумывай способности и факты. Не пиши слова «из лора». Не путай роль чемпиона с выбранной линией. Проценты в данных уже даны как проценты. Верни только JSON-объект: ключи — точные ключи рангов, значения — строки.

Чемпион: ${task.championName} (${task.championSlug})
Линия: ${task.lane}
Официальный лор: ${task.lore.officialLore}
Статистика по рангам: ${JSON.stringify(task.statsByRank)}`;
}

async function generate(task) {
  const response = await fetch(`${ollamaOrigin}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: prompt(task), stream: false, format: "json", options: { temperature: 0.75, top_p: 0.9 } }),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  return JSON.parse(payload.response);
}

async function generateComplete(task) {
  const expectedRanks = Object.keys(task.statsByRank);
  let lastMissing = expectedRanks;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const responses = await generate(task);
    lastMissing = expectedRanks.filter((rank) => typeof responses[rank] !== "string" || !responses[rank].trim());
    if (!lastMissing.length) return responses;
  }
  throw new Error(`Ollama omitted ranks: ${lastMissing.join(", ")}`);
}

const bundle = await api("/api/assistant/tasks");
if (requestedSlug) bundle.tasks = bundle.tasks.filter((task) => task.championSlug === requestedSlug);
const results = [];
async function flush() {
  if (!results.length) return;
  const items = results.splice(0, results.length);
  await api("/api/assistant/sync", { method: "POST", body: JSON.stringify({ items }) });
}
let completed = 0;
for (const task of bundle.tasks) {
  try {
    const responses = await generateComplete(task);
    for (const [rank, response] of Object.entries(responses)) {
      if (!task.statsByRank[rank] || typeof response !== "string") continue;
      results.push({ championSlug: task.championSlug, lane: task.lane, rank, response, statsSnapshotId: bundle.snapshotId, loreContentHash: task.lore.contentHash, model });
    }
    completed += 1;
    console.log(`[assistant] ${completed}/${bundle.tasks.length} ${task.championSlug} ${task.lane}`);
  } catch (error) {
    console.error(`[assistant] failed ${task.championSlug} ${task.lane}:`, error.message);
  }
  if (results.length >= 100) await flush();
}
await flush();
console.log(`[assistant] done: ${completed}/${bundle.tasks.length}`);
