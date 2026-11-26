import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { eligibility, JOBS, LEASE_MS } from "./scrapeSchedule.mjs";

// All existing importers can touch the champion catalog: serialize across jobs too.
const LOCK = [1936876912, 1];

export function connectScrapeStore(url, { onclose = () => {}, readonly = false } = {}) {
  if (!url) throw new Error("DATABASE_URL is required");
  return postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 0, max_lifetime: null,
    onclose, onnotice() {}, connection: { application_name: "wildrift-scrape-coordinator",
      statement_timeout: 15_000, idle_in_transaction_session_timeout: 30_000, tcp_keepalives_idle: 30, tcp_keepalives_interval: 10, tcp_keepalives_count: 3,
      ...(readonly ? { default_transaction_read_only: "on" } : {}) } });
}

export async function acquireCoordinator(sql) {
  const [row] = await sql`select pg_try_advisory_lock(${LOCK[0]}, ${LOCK[1]}) as acquired, pg_backend_pid() as pid`;
  return row;
}

export async function releaseCoordinator(sql) {
  await sql`select pg_advisory_unlock(${LOCK[0]}, ${LOCK[1]})`;
}

export async function claimJob(sql, job, executor, options = {}) {
  return sql.begin(async tx => {
    const [{ now }] = await tx`select clock_timestamp() as now`;
    const active = await tx`select id from scrape_runs where status = 'running' and heartbeat_at > ${new Date(+now - LEASE_MS)}`;
    if (active.length) return { due: false, reason: "active-lease" };
    await tx`update scrape_runs set status = 'interrupted', finished_at = ${now}, result = 'Исполнитель потерял связь или завершился без результата' where status = 'running'`;
    const [state] = await tx`select * from scrape_job_state where job = ${job} for update`;
    if (!state || !JOBS[job]) throw new Error("Scrape schema is not initialized");
    const plan = eligibility(JOBS[job], state, now, options);
    if (!plan.due) return plan;
    const id = randomUUID();
    await tx`insert into scrape_runs (id, job, executor, trigger, scheduled_at, status, revision, run_url)
      values (${id}, ${job}, ${executor}, ${plan.reason}, ${plan.scheduledAt}, 'running', ${options.revision || null}, ${options.runUrl || null})`;
    await tx`update scrape_job_state set last_started_at = ${now}, last_executor = ${executor}, last_run_id = ${id} where job = ${job}`;
    return { ...plan, id };
  });
}

export async function heartbeat(sql, id, pid, step, logTail) {
  const [connection] = await sql`select pg_backend_pid() as pid`;
  if (connection.pid !== pid) throw new Error("Coordinator connection changed; stopping importer");
  const rows = await sql`update scrape_runs set heartbeat_at = clock_timestamp(), step = ${step}, log_tail = ${logTail} where id = ${id} and status = 'running' returning id`;
  if (rows.length !== 1) throw new Error("Run ownership lost");
}

export async function finishJob(sql, run, status, result, logTail, complete = true) {
  await sql.begin(async tx => {
    const rows = await tx`update scrape_runs set status = ${status}, finished_at = clock_timestamp(), heartbeat_at = clock_timestamp(), result = ${result}, log_tail = ${logTail}
      where id = ${run.id} and status = 'running' returning job, started_at`;
    if (rows.length !== 1) throw new Error("Run no longer owned");
    if (status === "success" && complete) await tx`update scrape_job_state set last_success_at = clock_timestamp() where job = ${rows[0].job}`;
    await tx`delete from scrape_runs where status <> 'running' and finished_at < clock_timestamp() - interval '90 days' and id not in (select last_run_id from scrape_job_state where last_run_id is not null)`;
  });
}

export async function readScrapeStatus(sql) {
  const [{ now }] = await sql`select clock_timestamp() as now`;
  const states = await sql`select * from scrape_job_state order by job`;
  const history = await sql`select * from scrape_runs order by started_at desc limit 120`;
  return { version: 1, collectedAt: now, ok: true, fallbackHours: 2,
    jobs: states.map(state => ({ ...state, title: JOBS[state.job]?.title || state.job,
      ...eligibility(JOBS[state.job], state, now, { fallback: true }) })),
    history: history.map(row => ({ ...row, alive: row.status === "running" && +now - +row.heartbeat_at < LEASE_MS })) };
}
