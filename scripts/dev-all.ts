import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Starts: local relay (:8090) + CLI (dashboard :4000) which itself runs the demo app (:3000) under `tsx watch`.
// A separate CBF_HOME keeps this dev tunnel apart from any real one made with `cbf init`.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(root, '.cbf-dev');
const RELAY_PORT = 8090;
const relayUrl = `http://localhost:${RELAY_PORT}`;
const env = {
  ...process.env,
  CBF_HOME: home,
  DB_PATH: path.join(home, 'relay.db'),
};
fs.mkdirSync(home, { recursive: true });

const children: ChildProcess[] = [];
const kill = (c: ChildProcess) => {
  if (!c.pid || c.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
  else c.kill('SIGTERM');
};
const shutdown = () => {
  children.forEach(kill);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => {
  const c = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: root, env: { ...env, ...extra }, stdio: 'inherit' });
  children.push(c);
  return c;
};

async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${relayUrl}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('relay did not start');
}

run(['packages/relay/src/index.ts'], { PORT: String(RELAY_PORT) });
await waitHealth();
spawnSync(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', 'init', '--relay', relayUrl], { cwd: root, env, stdio: 'inherit' });
const cli = run(
  ['packages/cli/src/index.ts', 'start', '--port', '3000', '--src', '.', '--dashboard-port', '4000', '--', 'npm', 'run', '-s', 'demo:app'],
  {},
);
cli.on('exit', shutdown);
console.log('\nPorts: relay :8090 · demo app :3000 · dashboard :4000 · model server (yours) :8080\n');
