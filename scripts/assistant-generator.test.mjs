import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function scenario(args, answer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-generator-'));
  const received = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/chat/completions') res.end(JSON.stringify({ model: 'test-gemma', choices: [{ finish_reason: answer.finish || 'stop', message: { content: JSON.stringify({ tipIndex: answer.index }) } }] }));
    else if (req.url === '/api/assistant/sync') { received.push(...data.items); res.end(JSON.stringify({ accepted: data.items.length })); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const context = path.join(dir, 'tasks.json');
    await fs.writeFile(context, JSON.stringify({ snapshotId: 42, statsDate: '2026-10-24', tasks: ['ahri', 'jinx'].map(championSlug => ({ championSlug, championName: championSlug, lane: 'mid', stableTips: [{ text: 'Approved tip' }], lore: { contentHash: 'hash' }, statsByRank: { overall: { winRate: 51, pickRate: 4, banRate: 1 } } })) }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./generate-assistant-responses.mjs', import.meta.url)), '--provider', 'lmstudio', '--origin', origin, '--model', 'test-gemma', ...args], { windowsHide: true, env: { ...process.env, WR_API_ORIGIN: origin, GUIDES_SYNC_SECRET: 'test-only', DOTENV_CONFIG_PATH: path.join(dir, 'none'), REPKA_STATS_CONTEXT_FILE: context, REPKA_JOB_CONFIG_JSON: '' } });
      let output = ''; child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
      child.once('error', reject); child.once('close', code => resolve({ code, output }));
    });
    return { ...result, received };
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); }
}
test('--slug limits even default all scope and confirms actual accepted count', async () => {
  const result = await scenario(['--slug', 'ahri'], { index: 0 });
  assert.equal(result.code, 0); assert.equal(result.received.length, 1); assert.equal(result.received[0].championSlug, 'ahri');
  assert.match(result.output, /"accepted":1,"productionSync":true/);
});
test('invalid tip index never falls through as a successful template import', async () => {
  const result = await scenario([], { index: 999 });
  assert.equal(result.code, 1); assert.equal(result.received.length, 0);
});
test('truncated reasoning cannot become an accepted answer', async () => {
  const result = await scenario([], { index: 0, finish: 'length' });
  assert.equal(result.code, 1); assert.equal(result.received.length, 0);
});
test('dry run does not claim any production import', async () => {
  const result = await scenario(['--dry-run'], { index: null });
  assert.equal(result.code, 0); assert.equal(result.received.length, 0); assert.match(result.output, /"productionSync":false/);
});
