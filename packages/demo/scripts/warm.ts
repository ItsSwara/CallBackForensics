import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { isAiOk } from '@cbf/core';
import { startAgent } from '../../cli/src/agent.js';
import { createRelay } from '../../relay/src/server.js';
import { demoDir, repoRoot, SCENARIOS } from '../scenarios.js';
import { sendScenario } from '../sender/send.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

async function waitForApp(port: number) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error('demo app did not start');
}

/**
 * Pushes every scenario through the real pipeline (relay -> websocket -> CLI -> demo app -> stderr capture ->
 * diagnosis -> local model). The model's real answers land in the shared AI cache, so the live demo is instant.
 */
async function main() {
  const { values } = parseArgs({ options: { 'ai-url': { type: 'string' } } });
  const aiUrl = values['ai-url'] || process.env.CBF_AI_URL || 'http://localhost:8080';

  const relay = createRelay({ dbPath: ':memory:', rateLimitPerMin: 10_000 });
  const relayUrl = `http://127.0.0.1:${await relay.start(0)}`;
  const tunnel = (await (await fetch(`${relayUrl}/api/tunnels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as {
    id: string;
    token: string;
  };

  const appPort = await freePort();
  const agent = await startAgent({
    relay: { relay: relayUrl, ...tunnel },
    port: appPort,
    aiUrl,
    srcDir: repoRoot,
    dashboardPort: 0,
    appCommand: ['node', '--import', 'tsx', JSON.stringify(path.join(demoDir, 'app', 'server.ts'))],
    appEnv: { PORT: String(appPort) },
    dbPath: ':memory:',
    aiTimeoutMs: 180_000,
    quiet: true,
  });
  try {
    await waitForApp(appPort);
    for (let i = 0; i < 100 && agent.status().relay !== 'connected'; i++) await sleep(100);
    if (!agent.status().ai.online) console.warn(`WARNING: no model server at ${aiUrl}. Start llama-server first or nothing gets cached.\n`);
    const base = `${relayUrl}/cb/${tunnel.id}`;
    console.log('scenario'.padEnd(18), 'bad status'.padEnd(11), 'model answer');
    for (const { name } of SCENARIOS) {
      await sendScenario(base, name, 'good');
      const bad = await sendScenario(base, name, 'bad');
      await agent.idle();
      const d = agent.store.list()[0]?.diagnosis;
      const ai = d?.ai;
      const summary = isAiOk(ai) ? `${ai.cached ? 'cached' : 'cached now'} (${(ai.ms / 1000).toFixed(1)}s, ${ai.model})` : `no answer: ${ai && 'error' in ai ? ai.error.message : 'n/a'}`;
      console.log(name.padEnd(18), String(bad.status).padEnd(11), summary);
    }
  } finally {
    await agent.stop();
    await relay.stop();
  }
  process.exit(0);
}

main().catch((e: Error) => {
  console.error(`error: ${e.message}`);
  process.exit(1);
});
