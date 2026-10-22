import net from 'node:net';
import { parseArgs } from 'node:util';
import { checkAi } from '@localhook/core';
import { startAgent } from './agent.js';
import { loadConfig, publicUrl, saveConfig } from './config.js';

const HELP = `localhook - webhook debugger with a local explainer

Usage:
  localhook init --relay <url> [--force]
  localhook start [--port 3000] [--ai-url http://localhost:8080] [--src .] [--dashboard-port 4000] [--no-relay] [-- <app command>]
  localhook doctor [--port 3000] [--ai-url http://localhost:8080]

Env: LOCALHOOK_RELAY, LOCALHOOK_AI_URL, LOCALHOOK_HOME`;

const aiDefault = () => process.env.LOCALHOOK_AI_URL || 'http://localhost:8080';

function splitArgv(argv: string[]): { own: string[]; app: string[] } {
  const i = argv.indexOf('--');
  return i < 0 ? { own: argv, app: [] } : { own: argv.slice(0, i), app: argv.slice(i + 1) };
}

async function init(args: string[]) {
  const { values } = parseArgs({ args, options: { relay: { type: 'string' }, force: { type: 'boolean' } } });
  const relay = (values.relay || process.env.LOCALHOOK_RELAY || '').replace(/\/+$/, '');
  if (!relay) throw new Error('Pass --relay <url> (or set LOCALHOOK_RELAY).');
  const existing = loadConfig();
  if (existing && existing.relay === relay && !values.force) {
    console.log('Already initialised. Your stable public URL is:\n');
    console.log(`  ${publicUrl(existing)}\n`);
    console.log('(Use --force to create a new tunnel; the old URL would stop working for you.)');
    return;
  }
  const res = await fetch(`${relay}/api/tunnels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`Relay refused to create a tunnel: HTTP ${res.status} ${await res.text()}`);
  const { id, token } = (await res.json()) as { id: string; token: string };
  saveConfig({ relay, id, token });
  console.log('Tunnel created. Your stable public URL (it never changes):\n');
  console.log(`  ${publicUrl({ relay, id })}\n`);
  console.log('Next: localhook start --port 3000');
}

async function start(args: string[], appCommand: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string', default: '3000' },
      'ai-url': { type: 'string' },
      src: { type: 'string', default: '.' },
      'dashboard-port': { type: 'string', default: '4000' },
      'no-relay': { type: 'boolean' },
    },
  });
  const relay = values['no-relay'] ? null : loadConfig();
  if (!values['no-relay'] && !relay) throw new Error('No tunnel configured. Run: localhook init --relay <url>  (or use --no-relay for local-only mode)');
  const agent = await startAgent({
    relay,
    port: Number(values.port),
    aiUrl: values['ai-url'] || aiDefault(),
    srcDir: values.src!,
    dashboardPort: Number(values['dashboard-port']),
    appCommand,
  });
  console.log('');
  console.log(`  Public URL : ${agent.publicUrl ?? '(no tunnel: local-only mode)'}`);
  console.log(`  Dashboard  : ${agent.dashboardUrl}`);
  console.log(`  Forwarding : http://localhost:${values.port}`);
  console.log(`  AI model   : ${values['ai-url'] || aiDefault()}`);
  if (!appCommand.length) console.log('  Note       : no app command given, so stderr (stack traces) is not captured.');
  console.log('');
  const quit = () => {
    void agent.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('timeout', () => (s.destroy(), resolve(false)));
    s.once('error', () => resolve(false));
  });
}

async function doctor(args: string[]) {
  const { values } = parseArgs({ args, options: { port: { type: 'string', default: '3000' }, 'ai-url': { type: 'string' } } });
  const cfg = loadConfig();
  const mark = (ok: boolean) => (ok ? 'OK  ' : 'FAIL');
  let bad = 0;
  const row = (ok: boolean, text: string) => {
    if (!ok) bad++;
    console.log(`[${mark(ok)}] ${text}`);
  };
  row(!!cfg, cfg ? `config found (${publicUrl(cfg)})` : 'no config: run `localhook init --relay <url>`');
  if (cfg) {
    let ok = false;
    try {
      ok = (await fetch(`${cfg.relay}/health`, { signal: AbortSignal.timeout(4000) })).ok;
    } catch {
      /* unreachable */
    }
    row(ok, `relay reachable at ${cfg.relay}`);
  }
  const aiUrl = values['ai-url'] || aiDefault();
  const ai = await checkAi(aiUrl);
  row(ai.online, ai.online ? `AI server online at ${aiUrl}${ai.model ? ` (${ai.model})` : ''}` : `AI server not reachable at ${aiUrl} (rule-based findings still work)`);
  const port = Number(values.port);
  row(await portOpen(port), `app port :${port} is open`);
  process.exitCode = bad ? 1 : 0;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { own, app } = splitArgv(rest);
  switch (cmd) {
    case 'init':
      return init(own);
    case 'start':
      return start(own, app);
    case 'doctor':
      return doctor(own);
    default:
      console.log(HELP);
      process.exitCode = cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0;
  }
}

main().catch((e: Error) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
