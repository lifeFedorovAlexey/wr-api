import "dotenv/config";
import { createHash } from "node:crypto";
import { db, client } from "../db/client.js";
import { championStableTips, champions } from "../db/schema.js";
import { filterChampionsForPublicPool } from "../lib/championPublicPool.mjs";
import { getSourceChampionSlugCandidates } from "../lib/championSlug.mjs";
import { fetchChampionMechanics } from "../lib/riotChampionMechanics.mjs";

const onlyIndex = process.argv.indexOf("--slug");
const onlySlug = onlyIndex >= 0 ? String(process.argv[onlyIndex + 1] || "").toLowerCase() : "";
const dryRun = process.argv.includes("--dry-run");
const missingOnly = process.argv.includes("--missing-only");
const ollama = process.env.OLLAMA_ORIGIN || "http://127.0.0.1:11434";
const writerModel = process.env.OLLAMA_MODEL || "qwen3:8b";
const reviewerModel = process.env.OLLAMA_REVIEW_MODEL || "forzer/GigaChat3-10B-A1.8B:latest";

async function generate(model, prompt) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${ollama}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt, stream: false, format: "json", options: { temperature: 0.15, num_predict: 900 } }) });
      if (!response.ok) throw new Error(`Ollama ${response.status}`);
      return JSON.parse((await response.json()).response);
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function loadMechanics(champion) {
  let error;
  for (const slug of getSourceChampionSlugCandidates(champion.slug, "riot")) {
    try { return await fetchChampionMechanics(slug); } catch (current) { error = current; }
  }
  throw error;
}

const approvedSlugs = missingOnly
  ? new Set((await db.select().from(championStableTips)).filter((row) => row.reviewStatus === "approved").map((row) => row.championSlug))
  : new Set();
const rows = filterChampionsForPublicPool(await db.select().from(champions))
  .filter((row) => (!onlySlug || row.slug === onlySlug) && (!missingOnly || !approvedSlugs.has(row.slug)));
for (const [index, champion] of rows.entries()) {
  try {
    const mechanics = await loadMechanics(champion);
    const proposal = await generate(writerModel, `На основе только официальных описаний создай 2–3 консервативных совета по Wild Rift. Каждый совет — прямое преобразование ровно одного описания в действие игрока и ссылается на evidenceIndex. Нельзя добавлять условия, цели или причинность, которых буквально нет в evidence: ближний бой, матчап, порядок применения, комбинацию, повышение эффективности, позиционирование, предметы или мету. Пример допустимого преобразования: evidence «сфера замедляет врагов» → «Используй сферу, чтобы замедлять врагов». JSON {"tips":[{"text":"...","evidenceIndex":0,"lane":null}]}.
Чемпион: ${mechanics.championName}; механики: ${JSON.stringify(mechanics.abilities)}`);
    const candidates = Array.isArray(proposal.tips) ? proposal.tips.slice(0, 3) : [];
    const audit = await generate(reviewerModel, `Проверь советы строго против evidence. approved=true только если совет полностью следует из текста без добавленных механик, матчапов, билдов и патч-зависимых утверждений. JSON {"results":[{"index":0,"approved":true}]}.
Evidence: ${JSON.stringify(mechanics.abilities)}; советы: ${JSON.stringify(candidates)}`);
    const approved = new Map((audit.results || []).map((item) => [Number(item.index), item.approved === true]));
    for (const [tipIndex, tip] of candidates.entries()) {
      const evidence = mechanics.abilities[Number(tip.evidenceIndex)];
      if (!evidence || !String(tip.text || "").trim()) continue;
      const tipText = String(tip.text).trim();
      const unsupportedPattern = /ближн|матчап|танк|маг|сборк|сразу\s+(же\s+)?(после|примен)|комбин|повыс|улучш|эффектив|приоритет|позиционир/iu;
      const record = { championSlug: champion.slug, lane: tip.lane || null, tipText, sourceKind: "riot-wild-rift-champion-page", sourceUrl: mechanics.sourceUrl, sourceLabel: evidence.name, evidenceText: evidence.description, patchDependent: false, reviewStatus: approved.get(tipIndex) && !unsupportedPattern.test(tipText) ? "approved" : "rejected" };
      record.contentHash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
      if (dryRun) console.log("[stable-tips:dry-run]", record);
      else await db.insert(championStableTips).values(record).onConflictDoUpdate({ target: [championStableTips.championSlug, championStableTips.contentHash], set: { reviewStatus: record.reviewStatus, updatedAt: new Date() } });
    }
    console.log(`[stable-tips] ${index + 1}/${rows.length} ${champion.slug}: ${candidates.length}`);
  } catch (error) {
    console.error(`[stable-tips] failed ${champion.slug}:`, error.message);
  }
}
await client.end({ timeout: 5 });
