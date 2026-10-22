import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRelay, type Relay } from '../../relay/src/server.js';
import { startAgent, type Agent } from '../src/agent.js';

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let relay: Relay;
let relayUrl: string;
let appServer: http.Server;
let appPort: number;
const seen: Seen[] = [];

// bytes that would be mangled by any re-serialisation: invalid UTF-8, NULs, and a JSON-looking body with odd spacing
const RAW = Buffer.concat([Buffer.from('{ "a":1,  "b" : "x" }\n'), Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0d, 0x0a])]);

async function newTunnel(): Promise<{ id: string; token: string }> {
  const r = await fetch(`${relayUrl}/api/tunnels`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; token: string };
}

const waitFor = async (cond: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
};

beforeAll(async () => {
  relay = createRelay({ dbPath: ':memory:', rateLimitPerMin: 1000 });
  relayUrl = `http://127.0.0.1:${await relay.start(0)}`;
  appServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      if (req.url?.startsWith('/boom')) {
        res.statusCode = 500;
        res.end('exploded');
        return;
      }
      res.statusCode = 201;
      res.setHeader('x-from-app', 'yes');
      res.setHeader('content-type', 'application/octet-stream');
      res.end(Buffer.from('app-says-hi'));
    });
  });
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  appPort = (appServer.address() as { port: number }).port;
});

afterAll(async () => {
  appServer.closeAllConnections();
  appServer.close();
  await relay.stop();
});

describe('relay -> websocket -> cli -> local app', () => {
  it('forwards identical raw bytes, headers and query, and returns the app response', async () => {
    const t = await newTunnel();
    const agent: Agent = await startAgent({
      relay: { relay: relayUrl, ...t },
      port: appPort,
      aiUrl: 'http://127.0.0.1:1',
      srcDir: '.',
      dashboardPort: 0,
      dbPath: ':memory:',
      cachePath: null,
      quiet: true,
    });
    try {
      await waitFor(() => relay.isConnected(t.id));
      const sig = crypto.createHmac('sha256', 'secret').update(RAW).digest('hex');
      const res = await fetch(`${relayUrl}/h/${t.id}/hooks/stripe?x=1&y=two`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${sig}`, 'x-custom': 'abc' },
        body: RAW,
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('x-from-app')).toBe('yes');
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('app-says-hi');

      const got = seen[seen.length - 1];
      expect(got.method).toBe('POST');
      expect(got.url).toBe('/hooks/stripe?x=1&y=two');
      expect(Buffer.compare(got.body, RAW)).toBe(0);
      expect(got.headers['x-hub-signature-256']).toBe(`sha256=${sig}`);
      expect(got.headers['x-custom']).toBe('abc');
      expect(got.headers.host).toBe(`localhost:${appPort}`);
      // the HMAC computed by the receiver over the received bytes still verifies
      expect(crypto.createHmac('sha256', 'secret').update(got.body).digest('hex')).toBe(sig);

      // stored locally with the response
      const stored = agent.store.list();
      expect(stored[0]).toMatchObject({ method: 'POST', path: '/hooks/stripe', status: 201 });
      expect(Buffer.compare(stored[0].body, RAW)).toBe(0);
    } finally {
      await agent.stop();
    }
  });

  it('queues webhooks while the CLI is offline and flushes them in order on connect', async () => {
    const t = await newTunnel();
    const before = seen.length;
    for (const n of ['one', 'two']) {
      const r = await fetch(`${relayUrl}/h/${t.id}/queued/${n}`, { method: 'POST', body: n });
      expect(r.status).toBe(202);
      expect(await r.json()).toMatchObject({ queued: true });
    }
    const agent = await startAgent({
      relay: { relay: relayUrl, ...t },
      port: appPort,
      aiUrl: 'http://127.0.0.1:1',
      srcDir: '.',
      dashboardPort: 0,
      dbPath: ':memory:',
      cachePath: null,
      quiet: true,
    });
    try {
      await waitFor(() => seen.length >= before + 2);
      expect(seen.slice(before).map((s) => s.url)).toEqual(['/queued/one', '/queued/two']);
    } finally {
      await agent.stop();
    }
  });

  it('rejects unknown tunnels, bad tokens and oversized bodies', async () => {
    expect((await fetch(`${relayUrl}/h/nope/x`, { method: 'POST', body: 'a' })).status).toBe(404);
    const t = await newTunnel();
    expect((await fetch(`${relayUrl}/h/${t.id}/x`, { method: 'POST', body: Buffer.alloc(1024 * 1024 + 10, 1) })).status).toBe(413);
    const { WebSocket } = await import('ws');
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${relayUrl.replace('http', 'ws')}/tunnel?id=${t.id}&token=wrong`);
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => undefined);
    });
    expect(code).toBe(401);
  });

  it('diagnoses a failing request with rule-based findings, a stack frame and source, even with the model down', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-int-'));
    const src = path.join(dir, 'handler.ts');
    fs.writeFileSync(src, Array.from({ length: 12 }, (_, i) => `// line ${i + 1}`).join('\n'));
    const agent = await startAgent({
      relay: null,
      port: appPort,
      aiUrl: 'http://127.0.0.1:1',
      srcDir: dir,
      dashboardPort: 0,
      dbPath: ':memory:',
      cachePath: null,
      aiTimeoutMs: 2000,
      quiet: true,
    });
    try {
      // seed a good event, then a bad one, directly in the store (as relayed events would be stored)
      const { randomUUID } = await import('node:crypto');
      const mk = (id: string, status: number, body: unknown) => ({
        id,
        receivedAt: Date.now(),
        method: 'POST',
        path: '/boom',
        query: '',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(body)),
        status,
        respHeaders: {},
        respBody: Buffer.alloc(0),
        durationMs: 1,
        replayOf: null,
        stderrWindow: null,
        diagnosis: null,
        connectionFailed: false,
      });
      const good = mk(randomUUID(), 200, { customer: { email: 'a@b.c' } });
      agent.store.insert(good);
      const bad = mk(randomUUID(), 500, { customer: null });
      agent.store.insert(bad);
      // replay the bad payload: the fake app answers 500 for /boom, which triggers diagnosis
      agent.stderr.add('TypeError: Cannot read properties of null (reading \'email\')');
      agent.stderr.add(`    at handle (${src}:5:9)`);
      const r = await agent.replay(bad.id);
      expect(r?.event).toMatchObject({ status: 500 });
      await agent.idle();
      const ev = agent.store.get(r!.event.id as string)!;
      expect(ev.diagnosis?.ruleBased).toContain('customer: was object in last good payload, now null');
      expect(ev.diagnosis?.ai).toHaveProperty('error');
      expect(ev.diagnosis?.aiPending).toBe(false);
    } finally {
      await agent.stop();
    }
  });
});
