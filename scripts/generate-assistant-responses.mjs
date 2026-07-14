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

function prompt(task, rank, stats) {
  return `Ты — Люкс из League of Legends. Напиши одну короткую практическую рекомендацию игроку, максимум 130 символов, одним предложением. Обязательно дай конкретное действие: брать или не брать чемпиона, учитывать бан, ждать удобный матчап, держать дистанцию или играть осторожнее. Говори живо от лица Люкс. Допускается одна короткая узнаваемая метафора, мотив или сила оцениваемого чемпиона, только если она помогает совету.
Вердикт уже рассчитан: ${getVerdict(stats.winRate)}. Для слабого или ситуативного выбора советуй не брать вслепую, выбирать только знакомый матчап и играть осторожнее. Для среднего или сильного — учитывать драфт и банрейт. Не придумывай свойства вражеского или союзного состава.
Запрещены мотивационные и пафосные призывы вроде «сияй», «разгони тьму», «поверь в себя». Запрещено упоминать position или место в таблице. Запрещено пересказывать биографию, называть даты, возраст, родственников, места и случайные события. Не говори «из лора». Не выдумывай тренд по одному срезу. Не путай роль с выбранной линией. Называй чемпиона по имени, не используй «он», «она» или «с ним».
Хороший стиль: «Бери Люкс только в знакомый матчап и держи дистанцию — мой свет не спасёт от плохой позиции.»
Верни только JSON вида {"flavor":"одно предложение"}.

Чемпион: ${task.championName} (${task.championSlug})
Линия: ${task.lane}
Ранг: ${rank}
Официальный лор: ${task.lore.officialLore}
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
      if (typeof payload.flavor === "string" && payload.flavor.trim().length >= 45 && payload.flavor.trim().length <= 160) {
        return payload.flavor.trim();
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Ollama returned a short or invalid response");
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
  let completedRanks = 0;
  for (const [rank, stats] of Object.entries(task.statsByRank)) {
    try {
      const flavor = await generateComplete(task, rank, stats);
      const response = `${buildAssessment(task, stats)} ${flavor}`;
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
