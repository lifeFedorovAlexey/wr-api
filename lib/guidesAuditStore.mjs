import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const AUDIT_ROOT_DIR = path.resolve(process.cwd(), ".runtime", "guides-audit");
const AUDIT_RUNS_DIR = path.join(AUDIT_ROOT_DIR, "runs");
const AUDIT_INDEX_PATH = path.join(AUDIT_ROOT_DIR, "index.json");
const AUDIT_HISTORY_LIMIT = 40;

function toIsoNow() {
  return new Date().toISOString();
}

async function ensureAuditStore() {
  await mkdir(AUDIT_RUNS_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await ensureAuditStore();
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function readIndex() {
  const payload = await readJson(AUDIT_INDEX_PATH, { runs: [] });
  return Array.isArray(payload?.runs) ? payload : { runs: [] };
}

async function writeIndex(runs = []) {
  const orderedRuns = [...runs]
    .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))
    .slice(0, AUDIT_HISTORY_LIMIT);
  await writeJson(AUDIT_INDEX_PATH, { runs: orderedRuns });
  return orderedRuns;
}

function toMismatchRow(row = {}) {
  return {
    rank: row.rank || "",
    lane: row.lane || "",
    sectionKey: row.sectionKey || "",
    sectionLabel: row.sectionLabel || "",
    status: row.status || "",
    siteDataDate: row.siteDataDate || null,
    sourceDataDate: row.sourceDataDate || null,
    siteVisibleCount: Number(row.siteVisibleCount || 0),
    siteTotalCount: Number(row.siteTotalCount || 0),
    sourceVisibleCount: Number(row.sourceVisibleCount || 0),
    sourceTotalCount: Number(row.sourceTotalCount || 0),
  };
}

function toIssueRow(issue = {}) {
  const details = Object.fromEntries(
    Object.entries(issue).filter(([key]) => !["section", "message"].includes(key)),
  );

  return {
    section: issue.section || "",
    message: issue.message || "",
    details,
  };
}

function buildChampionRow(result = {}) {
  const mismatches = Array.isArray(result.comparisonMismatches)
    ? result.comparisonMismatches.map(toMismatchRow)
    : [];
  const issues = Array.isArray(result.issues) ? result.issues.map(toIssueRow) : [];

  return {
    slug: String(result.slug || "").trim(),
    ok: Boolean(result.ok),
    checkedCombos: Array.isArray(result.checkedCombos) ? result.checkedCombos.length : 0,
    expectedWrfVariants: Number(result.expectedWrfVariants || 0),
    issuesCount: issues.length,
    mismatchCount: mismatches.length,
    failedSections: Array.from(
      new Set(
        mismatches
          .map((item) => item.sectionLabel)
          .concat(issues.map((item) => item.section))
          .filter(Boolean),
      ),
    ),
    mismatches,
    issues,
  };
}

export function buildGuidesAuditReport(run, audit = {}) {
  const championRows = Array.isArray(audit.results)
    ? audit.results.map(buildChampionRow).filter((item) => item.slug)
    : [];
  const issueCount = championRows.reduce((sum, row) => sum + row.issuesCount, 0);
  const mismatchCount = championRows.reduce((sum, row) => sum + row.mismatchCount, 0);
  const checkedCombos = championRows.reduce((sum, row) => sum + row.checkedCombos, 0);
  const failedChampions = championRows.filter((row) => !row.ok);
  const sectionCounts = new Map();

  for (const champion of failedChampions) {
    for (const section of champion.failedSections) {
      sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
    }
  }

  return {
    id: run.id,
    scope: run.scope,
    slug: run.slug || null,
    status: failedChampions.length ? "failed" : "passed",
    startedAt: audit.startedAt || run.startedAt || toIsoNow(),
    finishedAt: audit.finishedAt || toIsoNow(),
    options: audit.options || null,
    totals: {
      champions: championRows.length,
      passed: Number(audit.passed || 0),
      failed: Number(audit.failed || 0),
      issues: issueCount,
      mismatches: mismatchCount,
      checkedCombos,
    },
    failureSections: Array.from(sectionCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    championRows,
    failedChampions,
  };
}

export async function listGuidesAuditRuns(limit = 20) {
  const { runs } = await readIndex();
  return runs.slice(0, limit);
}

export async function createGuidesAuditRun(input = {}) {
  const { runs } = await readIndex();
  const run = {
    id: randomUUID(),
    scope: input.scope === "single" ? "single" : "all",
    slug: input.slug ? String(input.slug).trim() : null,
    status: "running",
    startedAt: toIsoNow(),
    finishedAt: null,
    processedCount: 0,
    targetCount: Number.isFinite(input.targetCount) ? input.targetCount : null,
    passedCount: 0,
    failedCount: 0,
    issueCount: 0,
    mismatchCount: 0,
    checkedCombos: 0,
    lastSlug: null,
    errorMessage: null,
  };

  await writeIndex([run, ...runs]);
  return run;
}

export async function updateGuidesAuditRun(runId, patch = {}) {
  const { runs } = await readIndex();
  const nextRuns = runs.map((run) => (
    run.id === runId
      ? { ...run, ...patch }
      : run
  ));
  await writeIndex(nextRuns);
  return nextRuns.find((run) => run.id === runId) || null;
}

export async function writeGuidesAuditReport(runId, report) {
  await writeJson(path.join(AUDIT_RUNS_DIR, `${runId}.json`), report);
  return report;
}

export async function readGuidesAuditReport(runId) {
  if (!runId) return null;
  return await readJson(path.join(AUDIT_RUNS_DIR, `${runId}.json`), null);
}
