import test from 'node:test';
import assert from 'node:assert/strict';
import { lmRuntime, MODEL } from './assistant-lm-runtime.mjs';

function fake({ daemon = true, server = true, models = [], failLoad = false } = {}) {
  const calls = [], saved = [];
  const command = async args => {
    calls.push(args.join(' '));
    if (args[0] === 'daemon' && args[1] === 'status') return JSON.stringify({ status: daemon ? 'running' : 'stopped', pid: 123, isDaemon: true });
    if (args[0] === 'server' && args[1] === 'status') return JSON.stringify({ running: server, port: 1234 });
    if (args[0] === 'ps') return JSON.stringify(models);
    if (args[0] === 'daemon' && args[1] === 'up') daemon = true;
    if (args[0] === 'load') { if (failLoad) throw new Error('load failed'); models.push({ modelKey: MODEL, identifier: args[args.indexOf('--identifier') + 1] }); }
    if (args[0] === 'unload') models = models.filter(item => item.identifier !== args[1]);
    return '';
  };
  return { calls, saved, runtime: lmRuntime({ command, identity: async () => 'socket-123', save: async value => saved.push(structuredClone(value)) }) };
}
test('pre-existing desktop, API and model are left untouched', async () => {
  const f = fake({ models: [{ modelKey: MODEL, identifier: 'user-gemma' }] });
  assert.equal(await f.runtime.start(), 'user-gemma'); await f.runtime.close();
  assert.equal(f.calls.some(call => /unload|stop|down|load |up/.test(call)), false);
});
test('resources started by the job are all released', async () => {
  const f = fake({ daemon: false, server: false });
  await f.runtime.start(); await f.runtime.close();
  assert.ok(f.calls.some(value => value.startsWith('unload wildrift-gemma4-')));
  assert.ok(f.calls.includes('server stop')); assert.ok(f.calls.includes('daemon down'));
  assert.ok(f.saved.some(value => value.model?.startsWith('wildrift-gemma4-')));
});
test('pre-existing API and other models survive', async () => {
  const f = fake({ models: [{ modelKey: 'other', identifier: 'user-other' }] });
  await f.runtime.start(); await f.runtime.close();
  assert.ok(f.calls.some(value => value.startsWith('unload wildrift-gemma4-')));
  assert.equal(f.calls.includes('server stop'), false); assert.equal(f.calls.includes('daemon down'), false);
});
test('a listener replaced after crash is not stopped, nor is its daemon', async () => {
  const calls=[];
  const runtime=lmRuntime({ ownership:{server:true,serverIdentity:'old',daemon:true,daemonPid:123},identity:async()=>'new',command:async args=>{calls.push(args.join(' '));return '[]';} });
  await runtime.close(); assert.deepEqual(calls, []);
});
test('uncertain ownership is kept pending without stopping a user resource', async () => {
  const calls=[];
  const runtime=lmRuntime({ ownership:{server:true,daemon:true,daemonPid:123},identity:async()=>'new',command:async args=>{calls.push(args.join(' '));return JSON.stringify({status:'running',pid:123,isDaemon:true});} });
  await assert.rejects(runtime.close(), /cleanup pending/); assert.deepEqual(calls, []);
});
test('failed model load still closes resources it started', async () => {
  const f = fake({ daemon: false, server: false, failLoad: true });
  await assert.rejects(f.runtime.start(), /load failed/); await f.runtime.close();
  assert.ok(f.calls.includes('server stop')); assert.ok(f.calls.includes('daemon down'));
  assert.equal(f.calls.some(call => call.startsWith('unload ')), false);
});
