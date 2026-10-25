import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import postgres from "postgres";
import { acquireCoordinator, releaseCoordinator, claimJob, heartbeat, finishJob } from "../lib/scrapeStore.mjs";
import { runPatchNotesImport } from "../lib/patchNotesImport.mjs";

test("PostgreSQL: mutual exclusion, stale lease recovery and successful/failed freshness", { skip: !process.env.SCRAPE_TEST_DATABASE_URL, timeout: 25000 }, async () => {
  const url = new URL(process.env.SCRAPE_TEST_DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/wildrift_dev') throw new Error('Integration tests require the local dev database');
  const schema = 'scrape_test_' + Date.now();
  const admin = postgres(url.href, { max: 1, connect_timeout: 5, onnotice() {} });
  const options = { max: 1, connect_timeout: 5, onnotice() {}, connection: { search_path: schema, statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 } };
  const a = postgres(url.href, options), b = postgres(url.href, options);
  try {
    await admin.unsafe(`create schema ${schema}`);
    await a.unsafe(await fs.readFile(new URL('../ops/wildrift-worker/schema.sql', import.meta.url), 'utf8'));
    const first = await acquireCoordinator(a);
    assert.equal(first.acquired, true);
    assert.equal((await acquireCoordinator(b)).acquired, false);
    const run = await claimJob(a, 'stats', 'kolvrt', { force: true });
    await heartbeat(a, run.id, first.pid, 'fetch', 'redacted');
    assert.equal((await claimJob(a, 'riftgg', 'kolvrt', { force: true })).reason, 'active-lease');
    await finishJob(a, run, 'failed', 'test failure', '');
    assert.equal((await a`select last_success_at from scrape_job_state where job='stats'`)[0].last_success_at, null);
    const success = await claimJob(a, 'stats', 'kolvrt', { force: true });
    await finishJob(a, success, 'success', 'unchanged is success', '');
    assert.ok((await a`select last_success_at from scrape_job_state where job='stats'`)[0].last_success_at);
    assert.equal((await claimJob(a, 'stats', 'github', { fallback: true })).due, false);
    const partial = await claimJob(a, 'guides', 'github', { force: true });
    await finishJob(a, partial, 'success', 'targeted only', '', false);
    assert.equal((await a`select last_success_at from scrape_job_state where job='guides'`)[0].last_success_at, null);
    const patchSuccess = await claimJob(a, 'patch-notes', 'kolvrt', { force: true });
    await finishJob(a, patchSuccess, 'success', 'previous complete import', '');
    const [{ last_success_at: previousPatchSuccess }] = await a`select last_success_at from scrape_job_state where job='patch-notes'`;
    const patchFailure = await claimJob(a, 'patch-notes', 'kolvrt', { force: true });
    let patchStatus = 'success';
    try {
      await runPatchNotesImport({
        loadIndex: async () => [{ version: '7.3c' }], loadReadyEnglish: async () => [],
        importPatch: async () => 'failed', markFailed: async () => {}, log: { log() {}, error() {} },
      });
    } catch { patchStatus = 'failed'; }
    await finishJob(a, patchFailure, patchStatus, 'article failed', '');
    assert.equal((await a`select status from scrape_runs where id=${patchFailure.id}`)[0].status, 'failed');
    assert.equal(+(await a`select last_success_at from scrape_job_state where job='patch-notes'`)[0].last_success_at, +previousPatchSuccess);
    const orphan = await claimJob(a, 'riftgg', 'kolvrt', { force: true });
    await a`update scrape_runs set heartbeat_at=now()-interval '91 seconds' where id=${orphan.id}`;
    await releaseCoordinator(a);
    assert.equal((await acquireCoordinator(b)).acquired, true);
    const replacement = await claimJob(b, 'riftgg', 'github', { force: true });
    assert.equal(replacement.due, true);
    assert.equal((await b`select status from scrape_runs where id=${orphan.id}`)[0].status, 'interrupted');
    await assert.rejects(heartbeat(a, replacement.id, -1, 'bad session', ''), /connection changed/);
    await finishJob(b, replacement, 'success', 'recovered', '');
  } finally {
    await Promise.all([a.end({timeout: 2}), b.end({timeout: 2})]);
    // Only this test's freshly created schema; no application tables touched.
    await admin.unsafe(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
