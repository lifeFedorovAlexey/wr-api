import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lmRuntime, MODEL } from './assistant-lm-runtime.mjs';

const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const directory = path.resolve(argument('--state-dir', '.runtime/assistant'));
const envFile = path.resolve(argument('--env-file', '.env'));
const sshHost = argument('--ssh-host', 'kolvrt');
const now = () => new Date().toISOString();
await fs.mkdir(directory, { recursive: true });
async function read(name, fallback = {}) { try { return JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
async function write(name, data) { const file = path.join(directory, name); const temp = `${file}.${randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify(data)); await fs.rename(temp, file); }
const lock = path.join(directory, 'lock');
try { await fs.mkdir(lock); } catch (e) {
  if (e.code !== 'EEXIST') throw e;
  let owner;
  try { owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8')); } catch {
    if (Date.now() - (await fs.stat(lock)).mtimeMs < 60000) { console.log('Another tick is acquiring its lock'); process.exit(0); }
    owner = { pid: null };
  }
  let alive = true;
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) alive = false;
  else try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  if (alive) { console.log('Assistant worker already running'); process.exit(0); }
  await fs.rm(path.join(lock, 'owner.json'), { force: true }); await fs.rmdir(lock); await fs.mkdir(lock);
}
let status = { history: [] }, runtime;
let child, heartbeat, stopping = false, delivery = Promise.resolve();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(); });
function remotePublish(value) {
  const script = "import json,os,sys,tempfile; d='/srv/data/wildrift-worker/assistant'; v=json.load(sys.stdin); f,p=tempfile.mkstemp(dir=d); os.fchmod(f,0o644); s=os.fdopen(f,'w'); json.dump(v,s,ensure_ascii=False); s.close(); os.replace(p,d+'/status.json')";
  return new Promise((resolve, reject) => {
    const proc = execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', sshHost, `python3 -c "${script}"`], { windowsHide: true, timeout: 15000, maxBuffer: 16384 }, error => error ? reject(new Error('Status delivery to kolvrt failed')) : resolve());
    proc.stdin.on('error', () => {}); proc.stdin.end(JSON.stringify(value));
  });
}
async function publish(remote = true) {
  status.heartbeatAt = now(); status.executor = os.hostname(); status.model = MODEL;
  const value = structuredClone(status);
  delivery = delivery.catch(() => {}).then(async () => {
    await write('status.json', value);
    if (remote) try { await remotePublish(value); } catch { console.error('Status delivery to kolvrt failed; next tick will retry'); }
  });
  await delivery;
}
function dailySlot() {
  // Moscow has UTC+3 with no DST; 06:30 Moscow is 03:30 UTC.
  const date = new Date(); date.setUTCHours(3, 30, 0, 0);
  if (date.getTime() > Date.now()) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString();
}
function onEvent(event) {
  if (!status.current) return;
  const run = status.current;
  if (event.type === 'start') Object.assign(run, { total: event.total, snapshotId: event.snapshotId, statsDate: event.statsDate, phase: 'generating' });
  if (event.type === 'progress') Object.assign(run, { generated: event.generated, failed: event.failed, champion: event.champion, phase: 'generating' });
  if (event.type === 'sync') Object.assign(run, { accepted: event.accepted, phase: 'importing' });
  if (event.type === 'done') Object.assign(run, event, { phase: 'verifying' });
}
async function generate(environment, model) {
  const samples = [];
  await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [fileURLToPath(new URL('./generate-assistant-responses.mjs', import.meta.url)), '--provider', 'lmstudio', '--model', model, '--model-key', MODEL], {
      windowsHide: true, env: { ...process.env, ...environment, DOTENV_CONFIG_PATH: envFile, REPKA_JOB_CONFIG_JSON: '', REPKA_STATS_CONTEXT_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pending = '', errorLines = [], timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; child.kill(); }, 2 * 60 * 60 * 1000);
    child.stdout.on('data', chunk => {
      pending += chunk.toString(); const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) {
        if (line.startsWith('[assistant-event] ')) onEvent(JSON.parse(line.slice(18)));
        if (line.startsWith('[assistant-result] ')) { const result = JSON.parse(line.slice(19)); if (!samples.length) samples.push(result); else samples[1] = result; }
      }
    });
    child.stderr.on('data', chunk => { errorLines.push(chunk.toString().replaceAll(environment.GUIDES_SYNC_SECRET, '[redacted]').slice(-1000)); errorLines = errorLines.slice(-3); });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => { clearTimeout(deadline); child = null; code === 0 && !stopping ? resolve() : reject(new Error(timedOut ? 'Generation exceeded two hours' : `Generator failed (${code}): ${errorLines.join('').slice(-1200)}`)); });
  });
  return samples;
}
try {
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
  status = await read('status.json', { history: [] });
  runtime = lmRuntime({ ownership: await read('resources.json'), save: value => write('resources.json', value) });
  // Recover only resources claimed by an earlier interrupted invocation.
  await runtime.close();
  status.error = null; status.cleanupError = null;
  if (status.current) {
    if (status.completedSlot === status.current.slot && status.lastSuccessfulSync?.id === status.current.id) status.history.unshift(status.lastSuccessfulSync);
    else status.history.unshift({ ...status.current, status: 'interrupted', finished_at: now(), error: 'Previous worker stopped without a final result' });
    status.history = status.history.slice(0, 20);
    status.current = null;
  }
  const slot = dailySlot();
  const nextSlot = new Date(Date.parse(slot) + 86400000).toISOString();
  status.nextAt = status.completedSlot === slot ? nextSlot : new Date(Math.max(Date.parse(slot), Date.parse(status.retryAt || slot))).toISOString();
  status.state = status.history[0]?.status === 'failed' || status.verificationError ? 'warning' : 'idle';
  await publish();
  if (status.completedSlot !== slot && Date.parse(status.nextAt) <= Date.now() && !stopping) {
    const config = parseEnv(await fs.readFile(envFile, 'utf8'));
    if (config.WR_API_ORIGIN !== 'https://wildriftallstats.ru/wr-api' || !config.GUIDES_SYNC_SECRET) throw new Error('Production assistant API credentials are missing or target differs');
    const run = { id: randomUUID(), started_at: now(), status: 'running', phase: 'loading', generated: 0, accepted: 0, failed: 0, model: MODEL, slot };
    status.current = run; status.state = 'running';
    await publish();
    let publishing = false;
    heartbeat = setInterval(async () => { if (publishing) return; publishing = true; try { await publish(); } catch { console.error('Cannot save heartbeat'); } finally { publishing = false; } }, 15000);
    try {
      const model = await runtime.start();
      if (stopping) throw new Error('Worker interrupted');
      run.phase = 'loading-data';
      const samples = await generate({ WR_API_ORIGIN: config.WR_API_ORIGIN, GUIDES_SYNC_SECRET: config.GUIDES_SYNC_SECRET }, model);
      if (!(run.productionSync && run.total > 0 && run.accepted === run.total && run.generated === run.total && run.failed === 0)) throw new Error('Incomplete import: accepted count does not match expected total');
      run.status = 'success'; status.completedSlot = slot; status.retryAt = null; status.nextAt = nextSlot;
      status.lastSuccessfulSync = { ...run, finished_at: now() };
      // The API has confirmed all writes. A subsequent GET/cleanup failure must not repeat this import.
      await publish(false);
      try {
      for (const sample of samples) {
        const query = new URLSearchParams({ champion: sample.championSlug, lane: sample.lane, rank: sample.rank });
        const response = await fetch(`${config.WR_API_ORIGIN}/api/assistant/responses?${query}`, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Public text verification HTTP ${response.status}`);
        const result = await response.json();
        const item = result.item || result;
        if (item.response !== sample.response || Number(item.statsSnapshotId) !== Number(sample.statsSnapshotId) || Date.parse(item.updatedAt) < Date.parse(run.started_at)) throw new Error('Public API did not confirm imported text');
      }
      status.verificationError = null;
      } catch (error) { status.verificationError = error.message; }
    } catch (error) {
      run.status = stopping ? 'interrupted' : 'failed'; run.error = error.message;
      status.retryAt = new Date(Date.now() + 30 * 60000).toISOString(); status.nextAt = status.retryAt; process.exitCode = 1;
    } finally {
      run.phase = 'cleanup'; await publish();
      try { await runtime.close(); status.cleanupError = null; } catch (error) { status.cleanupError = error.message; process.exitCode = 1; }
      clearInterval(heartbeat); heartbeat = null;
      run.finished_at = now(); status.history = [{ ...run }, ...status.history].slice(0, 20); status.current = null;
      status.state = run.status === 'success' && !status.cleanupError && !status.verificationError ? 'idle' : 'warning'; await publish();
    }
  }
} catch (error) {
  status.state = 'warning'; status.error = error.message;
  console.error(error.message); process.exitCode = 1;
  await publish();
} finally {
  clearInterval(heartbeat);
  try { await runtime?.close(); } catch (error) { status.cleanupError = error.message; await publish(); process.exitCode = 1; }
  await delivery;
  await fs.rm(path.join(lock, 'owner.json'), { force: true }); await fs.rmdir(lock);
}
