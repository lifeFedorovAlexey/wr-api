import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
export const MODEL = 'google/gemma-4-e4b';
async function listenerIdentity() {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-NetTCPConnection -LocalPort 1234 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { '{0}:{1}:{2}' -f $_.LocalAddress,$_.OwningProcess,$_.CreationTime.ToUniversalTime().Ticks }) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 15000 });
  const value = stdout.trim() ? JSON.parse(stdout) : [];
  return JSON.stringify((Array.isArray(value) ? value : [value]).sort());
}

export async function lmsCommand(args) {
  const { stdout } = await exec('lms', args, { windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.trim();
}

// Persist ownership before each mutation so a subsequent tick can recover after a crash.
export function lmRuntime({ command = lmsCommand, identity = listenerIdentity, save = async () => {}, ownership = {} } = {}) {
  const state = ownership;
  const json = async args => JSON.parse(await command(args));
  const claim = async (key, value) => { state[key] = value; await save(state); };
  return {
    state,
    async start() {
      const daemon = await json(['daemon', 'status', '--json']);
      if (daemon.status !== 'running') {
        await claim('daemon', true);
        await command(['daemon', 'up', '--json']);
        await claim('daemonPid', (await json(['daemon', 'status', '--json'])).pid);
      }
      const server = await json(['server', 'status', '--json']);
      if (!server.running) {
        await claim('server', true);
        await command(['server', 'start', '--port', '1234', '--bind', '127.0.0.1']);
        const socket = await identity();
        if (socket === '[]') throw new Error('Cannot confirm LM Studio listener ownership');
        await claim('serverIdentity', socket);
      } else if (server.port !== 1234) {
        throw new Error('LM Studio already serves another port; its settings were preserved');
      }
      const loaded = await json(['ps', '--json']);
      const existing = loaded.find(item => item.modelKey === MODEL);
      if (existing) return existing.identifier;
      const identifier = `wildrift-gemma4-${randomUUID()}`;
      await claim('model', identifier);
      await command(['load', MODEL, '--identifier', identifier, '--context-length', '4096', '--yes']);
      return identifier;
    },
    async close() {
      const errors = [];
      for (const key of ['model', 'server', 'daemon']) {
        if (!state[key]) continue;
        try {
          if (key === 'model') {
            const loaded = await json(['ps', '--json']);
            if (loaded.some(item => item.identifier === state.model)) await command(['unload', state.model]);
          } else if (key === 'server') {
            const current = await identity();
            if (current !== '[]' && !state.serverIdentity) throw new Error('Listener ownership is uncertain');
            if (current !== '[]' && current === state.serverIdentity) await command(['server', 'stop']);
            if (current !== '[]' && current !== state.serverIdentity) delete state.daemon; // User replaced the listener; preserve its host too.
          } else {
            if (errors.includes('server')) throw new Error('Preserve daemon while listener ownership is uncertain');
            const daemon = await json(['daemon', 'status', '--json']);
            const models = daemon.status === 'running' ? await json(['ps', '--json']) : [];
            // A desktop instance or models opened by the user are no longer ours to close.
            if (daemon.status === 'running' && !state.daemonPid) throw new Error('Daemon ownership is uncertain');
            if (daemon.status === 'running' && daemon.isDaemon && daemon.pid === state.daemonPid && !models.length) await command(['daemon', 'down']);
          }
          delete state[key];
          await save(state);
        } catch { errors.push(key); }
      }
      if (errors.length) throw new Error(`LM Studio cleanup pending: ${errors.join(', ')}`);
    },
  };
}
