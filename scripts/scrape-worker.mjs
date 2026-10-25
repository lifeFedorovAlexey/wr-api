import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { JOBS, parseJobs, sanitizeLog } from "../lib/scrapeSchedule.mjs";
import { commandsFor } from "../lib/scrapeCommands.mjs";
import { connectScrapeStore, acquireCoordinator, releaseCoordinator, claimJob, heartbeat, finishJob, readScrapeStatus } from "../lib/scrapeStore.mjs";

const { values: args } = parseArgs({ options: {
  executor: { type: "string", default: "kolvrt" }, jobs: { type: "string" },
  fallback: { type: "boolean" }, force: { type: "boolean" }, status: { type: "boolean" },
  output: { type: "string" }, "check-only": { type: "boolean" }, slugs: { type: "string", default: "" },
} });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executor = args.executor;
if (!["kolvrt", "github"].includes(executor)) throw new Error("Invalid executor");
const slugs = args.slugs.trim().split(/\s+/).filter(Boolean);
if (slugs.some(slug => !/^[a-z0-9-]+$/.test(slug)) || (slugs.length && !args.force)) throw new Error("Slugs require an explicit manual run and valid champion names");
let child, stopping = false, lockHeld = false, logTail = "", step = "";
let killTimer;
function stopChild() {
  stopping = true;
  if (!child?.pid) return;
  const pid = child.pid;
  const kill = signal => { try { process.kill(process.platform === "win32" ? pid : -pid, signal); } catch (error) { if (error.code !== "ESRCH") console.error("Unable to stop child"); } };
  kill("SIGTERM");
  killTimer = setTimeout(() => kill("SIGKILL"), 5000);
  killTimer.unref();
}
process.on("SIGTERM", stopChild);
process.on("SIGINT", stopChild);
const sql = connectScrapeStore(process.env.DATABASE_URL, { readonly: args.status || args["check-only"], onclose: () => { if (lockHeld) stopChild(); } });

function runCommand(command) {
  return new Promise((resolve, reject) => {
    step = command.name;
    child = spawn(process.execPath, command.args, { cwd: command.cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DATABASE_POOL_MAX: "3", GUIDE_SYNC_CONCURRENCY: "2", RIFTGG_IMPORT_CONCURRENCY: "2" } });
    const append = chunk => { const clean = sanitizeLog(chunk.toString()); logTail = (logTail + clean).slice(-12000); process.stdout.write(clean); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      child = null;
      clearTimeout(killTimer);
      if (code === 0 && !stopping) resolve();
      else reject(new Error(`${command.name}: ${signal || code}${stopping ? " (остановлен)" : ""}`));
    });
  });
}

async function execute(run, job, pid) {
  logTail = "";
  step = job;
  let interval, watchdog, busy = false, lastHeartbeat = Date.now(), status = "success", result = slugs.length ? `Выборочный импорт: ${slugs.join(", ")}` : "Проверка и импорт завершены";
  const timeout = setTimeout(stopChild, JOBS[job].timeoutMs);
  try {
    await heartbeat(sql, run.id, pid, step, logTail);
    watchdog = setInterval(() => { if (Date.now() - lastHeartbeat > 30_000) stopChild(); }, 1000);
    interval = setInterval(async () => {
      if (busy) return;
      busy = true;
      try { await heartbeat(sql, run.id, pid, step, logTail); lastHeartbeat = Date.now(); }
      catch { stopChild(); }
      finally { busy = false; }
    }, 10_000);
    for (const command of commandsFor(job, root, slugs)) {
      if (stopping) throw new Error("Исполнитель остановлен");
      await runCommand(command);
    }
  } catch (error) {
    status = stopping ? "interrupted" : "failed";
    result = sanitizeLog(error.message);
    process.exitCode = 1;
  } finally {
    clearInterval(interval);
    clearInterval(watchdog);
    clearTimeout(timeout);
    await finishJob(sql, run, status, result, logTail, !slugs.length);
  }
}

async function main() {
  if (args.status || args["check-only"]) {
    const data = await readScrapeStatus(sql);
    if (args.output) {
      await fs.writeFile(args.output + ".tmp", JSON.stringify(data), { mode: 0o644 });
      await fs.rename(args.output + ".tmp", args.output);
    } else console.log(JSON.stringify(data, null, 2));
    return;
  }
  const lock = await acquireCoordinator(sql);
  if (!lock.acquired) { console.log("Другой сборщик уже выполняется"); return; }
  lockHeld = true;
  for (const job of parseJobs(args.jobs)) {
    if (stopping) break;
    const run = await claimJob(sql, job, executor, { fallback: args.fallback, force: args.force,
      revision: process.env.SCRAPE_REVISION || process.env.GITHUB_SHA || "unknown",
      runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null });
    console.log(`[worker] ${job}: ${run.reason}`);
    if (run.due) await execute(run, job, lock.pid);
    // Re-evaluate priorities on the next timer tick; long guide runs must not
    // queue several more imports ahead of the next hourly statistics check.
    if (run.due && !args.force) break;
  }
}

try { await main(); }
catch (error) { console.error(sanitizeLog(error.message)); process.exitCode = 1; }
finally {
  if (lockHeld) { lockHeld = false; try { await releaseCoordinator(sql); } catch { /* Connection may already be gone. */ } }
  await sql.end({ timeout: 5 });
}
