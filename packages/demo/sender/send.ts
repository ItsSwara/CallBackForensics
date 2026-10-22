import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, publicUrl, type Config } from '../../cli/src/config.js';
import { buildRequest, getScenario, repoRoot, type Kind } from '../scenarios.js';

const trimSlash = (u: string) => u.replace(/\/+$/, '');

/**
 * Resolve the public base URL: --url, then CBF_URL, then the local `dev:all` tunnel if its relay is up,
 * then the tunnel from `cbf init`.
 */
export async function resolveBase(flag?: string): Promise<string> {
  const url = flag || process.env.CBF_URL;
  if (url) return trimSlash(url);
  const dev = readConfig(path.join(repoRoot, '.cbf-dev', 'config.json'));
  if (dev) {
    try {
      if ((await fetch(`${dev.relay}/health`, { signal: AbortSignal.timeout(500) })).ok) return trimSlash(publicUrl(dev));
    } catch {
      /* dev relay is not running */
    }
  }
  const cfg = loadConfig();
  if (cfg) return trimSlash(publicUrl(cfg));
  throw new Error('No public URL. Pass --url <public url>, set CBF_URL, or run `cbf init --relay <url>` first.');
}

function readConfig(file: string): Config | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Config;
  } catch {
    return null;
  }
}

export async function sendScenario(base: string, scenario: string, kind: Kind): Promise<{ status: number; body: string; ms: number }> {
  const req = buildRequest(scenario, kind);
  const started = Date.now();
  const res = await fetch(base + req.path, { method: 'POST', headers: req.headers, body: new Uint8Array(req.body) });
  const body = await res.text();
  return { status: res.status, body, ms: Date.now() - started };
}

export function printResult(scenario: string, kind: Kind, r: { status: number; body: string; ms: number }) {
  console.log(`${scenario} ${kind}: HTTP ${r.status} in ${r.ms}ms  ${r.body.slice(0, 160)}`);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { url: { type: 'string' } } });
  const [scenario, kind] = positionals;
  if (!scenario || (kind !== 'good' && kind !== 'bad')) {
    console.error('Usage: npm run demo:send -- <scenario> good|bad [--url <public url>]');
    process.exit(1);
  }
  getScenario(scenario);
  const base = await resolveBase(values.url);
  console.log(`POST ${base}${getScenario(scenario).path}`);
  printResult(scenario, kind, await sendScenario(base, scenario, kind));
}

if (process.argv[1] && /send\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((e: Error) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
