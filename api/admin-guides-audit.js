import { getAdminSessionFromRequest, userHasAnyRole } from "../lib/adminAuth.mjs";
import {
  buildGuidesAuditReport,
  clearGuidesAuditStore,
  createGuidesAuditRun,
  listGuidesAuditRuns,
  readGuidesAuditReport,
  updateGuidesAuditRun,
  writeGuidesAuditReport,
} from "../lib/guidesAuditStore.mjs";
import { resolveAuditSlugs, runAudit } from "../scripts/audit-guides-ui-e2e.mjs";
import { setCors } from "./utils/cors.js";

const RUN_LIST_LIMIT = 24;
let activeRun = null;

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function resolveRequestOrigin(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "https").trim() || "https";
  const host =
    String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").trim() ||
    "wildriftallstats.ru";
  return `${proto}://${host}`;
}

function resolveAuditOrigins(req) {
  const requestOrigin = resolveRequestOrigin(req);
  const productionUiOrigin =
    process.env.GUIDES_AUDIT_UI_ORIGIN ||
    process.env.ADMIN_PUBLIC_ORIGIN ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV === "production" ? "https://wildriftallstats.ru" : "");
  const uiOrigin = String(productionUiOrigin || process.env.UI_PUBLIC_ORIGIN || requestOrigin)
    .replace(/\/+$/, "");
  const apiOrigin = String(
    process.env.GUIDES_AUDIT_API_ORIGIN ||
    process.env.API_PUBLIC_ORIGIN ||
    `${uiOrigin}/wr-api`,
  ).replace(/\/+$/, "");

  return { uiOrigin, apiOrigin };
}

function buildLiveRunPatch(report = {}) {
  return {
    processedCount: Number(report?.totals?.champions || 0),
    targetCount: Number(report?.totals?.champions || 0),
    passedCount: Number(report?.totals?.passed || 0),
    failedCount: Number(report?.totals?.failed || 0),
    issueCount: Number(report?.totals?.issues || 0),
    mismatchCount: Number(report?.totals?.mismatches || 0),
    checkedCombos: Number(report?.totals?.checkedCombos || 0),
    finishedAt: report?.finishedAt || null,
    status: report?.status || "failed",
    lastSlug:
      report?.championRows?.length
        ? report.championRows[report.championRows.length - 1].slug
        : null,
    errorMessage: null,
  };
}

async function requireAdminOperator(req, res) {
  const session = await getAdminSessionFromRequest(req);

  if (!session) {
    setNoStore(res);
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (!userHasAnyRole(session.user, ["owner", "admin"])) {
    setNoStore(res);
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  return session;
}

async function startAuditRun(run, req) {
  const { uiOrigin, apiOrigin } = resolveAuditOrigins(req);

  activeRun = run;

  try {
    const audit = await runAudit(
      {
        slug: run.scope === "single" ? run.slug : null,
        uiOrigin,
        apiOrigin,
        headless: true,
      },
      {
        onResolvedSlugs(slugs) {
          void updateGuidesAuditRun(run.id, {
            targetCount: slugs.length,
          }).then((updatedRun) => {
            activeRun = updatedRun;
          });
        },
        onGuideResult(result, progress) {
          const issuesCount = Array.isArray(result.issues) ? result.issues.length : 0;
          const mismatchCount = Array.isArray(result.comparisonMismatches)
            ? result.comparisonMismatches.length
            : 0;

          void updateGuidesAuditRun(run.id, {
            processedCount: progress.processedCount,
            targetCount: progress.totalCount,
            passedCount: (activeRun?.passedCount || 0) + (result.ok ? 1 : 0),
            failedCount: (activeRun?.failedCount || 0) + (result.ok ? 0 : 1),
            issueCount: (activeRun?.issueCount || 0) + issuesCount,
            mismatchCount: (activeRun?.mismatchCount || 0) + mismatchCount,
            checkedCombos:
              (activeRun?.checkedCombos || 0) +
              (Array.isArray(result.checkedCombos) ? result.checkedCombos.length : 0),
            lastSlug: result.slug || null,
          }).then((updatedRun) => {
            activeRun = updatedRun;
          });
        },
      },
    );

    const report = buildGuidesAuditReport(run, audit);
    await writeGuidesAuditReport(run.id, report);
    activeRun = await updateGuidesAuditRun(run.id, buildLiveRunPatch(report));
  } catch (error) {
    const message = error instanceof Error ? error.message : "guides_audit_failed";
    activeRun = await updateGuidesAuditRun(run.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: message,
    });
  } finally {
    activeRun = null;
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const session = await requireAdminOperator(req, res);
  if (!session) {
    return;
  }

  setNoStore(res);

  if (req.method === "GET") {
    const runId = String(req.query?.runId || "").trim();
    const runs = await listGuidesAuditRuns(RUN_LIST_LIMIT);
    const selectedRunId = runId || activeRun?.id || runs[0]?.id || "";
    const report = selectedRunId ? await readGuidesAuditReport(selectedRunId) : null;

    return res.status(200).json({
      ok: true,
      running: Boolean(activeRun),
      activeRun,
      runs,
      report,
      selectedRunId: selectedRunId || null,
      operator: {
        id: session.user.id,
        roles: session.user.roles || [],
      },
    });
  }

  if (req.method === "DELETE") {
    if (activeRun) {
      return res.status(409).json({
        error: "audit_already_running",
        activeRun,
      });
    }

    await clearGuidesAuditStore();

    return res.status(200).json({
      ok: true,
      running: false,
      activeRun: null,
      runs: [],
      report: null,
      selectedRunId: null,
      operator: {
        id: session.user.id,
        roles: session.user.roles || [],
      },
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (activeRun) {
    return res.status(409).json({
      error: "audit_already_running",
      activeRun,
    });
  }

  const mode = String(req.body?.mode || "all").trim() === "single" ? "single" : "all";
  const slug = mode === "single"
    ? String(req.body?.slug || "").trim()
    : "";

  if (mode === "single" && !slug) {
    return res.status(400).json({ error: "slug_required" });
  }

  const { apiOrigin } = resolveAuditOrigins(req);
  const targetSlugs = await resolveAuditSlugs({
    slug: mode === "single" ? slug : null,
    apiOrigin,
  });

  if (!targetSlugs.length) {
    return res.status(400).json({ error: "no_guide_slugs" });
  }

  const run = await createGuidesAuditRun({
    scope: mode,
    slug: mode === "single" ? slug : null,
    targetCount: targetSlugs.length,
  });

  activeRun = run;
  void startAuditRun(run, req);

  return res.status(202).json({
    ok: true,
    run,
  });
}
