import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { AiCache, analyzeRules, checkAi, runAi, type Evidence } from '@cbf/core';
import { spawnApp, type AppProcess } from './app-process.js';
import { cachePath as defaultCachePath, eventsDbPath, publicUrl as makePublicUrl, type Config } from './config.js';
import { forwardToLocal, type ForwardResult } from './forward.js';
import { StderrBuffer } from './stderr.js';
import { EventStore, type Headers, type StoredEvent } from './store.js';
import { TunnelClient, type RelayRequest, type RelayResponse, type TunnelState } from './tunnel.js';

export interface AgentOptions {
  /** Relay tunnel to connect to. Omit to run the dashboard + replay without a tunnel. */
  relay?: Config | null;
  port: number;
  aiUrl: string;
  srcDir: string;
  dashboardPort: number;
  appCommand?: string[];
  appEnv?: NodeJS.ProcessEnv;
  /** SQLite file for local events (":memory:" for throwaway runs). */
  dbPath?: string;
  /** Shared AI cache file; null disables caching. */
  cachePath?: string | null;
  aiTimeoutMs?: number;
  aiPollMs?: number;
  quiet?: boolean;
}

export interface Status {
  relay: TunnelState | 'none';
  ai: { online: boolean; model?: string };
  publicUrl: string | null;
  appPort: number;
  hasApp: boolean;
}

export interface Agent {
  store: EventStore;
  stderr: StderrBuffer;
  dashboardPort: number;
  dashboardUrl: string;
  publicUrl: string | null;
  status(): Status;
  replay(id: string): Promise<{ event: Record<string, unknown>; originalStatus: number | null; flipped: boolean } | undefined>;
  analyze(id: string, force?: boolean): Promise<boolean>;
  /** Resolves when all in-flight diagnoses (including model calls) have finished. */
  idle(): Promise<void>;
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failing = (status: number | null, conn: boolean) => conn || (status ?? 0) >= 400;

function bodyView(buf: Buffer, max = 256 * 1024) {
  const slice = buf.length > max ? buf.subarray(0, max) : buf;
  const text = slice.toString('utf8');
  const binary = text.includes('�') || text.includes('\0');
  return { size: buf.length, truncated: buf.length > max, text: binary ? null : text, base64: binary ? slice.toString('base64') : null };
}

function summary(e: StoredEvent) {
  const d = e.diagnosis;
  const aiState = !d ? 'none' : d.aiPending ? 'pending' : d.ai ? ('text' in d.ai ? 'done' : 'error') : 'none';
  return {
    id: e.id,
    receivedAt: e.receivedAt,
    method: e.method,
    path: e.path,
    query: e.query,
    status: e.status,
    durationMs: e.durationMs,
    replayOf: e.replayOf,
    connectionFailed: e.connectionFailed,
    aiState,
  };
}

function detail(e: StoredEvent) {
  return {
    ...summary(e),
    requestHeaders: e.headers,
    requestBody: bodyView(e.body),
    responseHeaders: e.respHeaders,
    responseBody: bodyView(e.respBody),
    stderrWindow: e.stderrWindow,
    diagnosis: e.diagnosis,
  };
}

const hostOk = (h?: string) => !!h && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);

export async function startAgent(o: AgentOptions): Promise<Agent> {
  const log = (...a: unknown[]) => {
    if (!o.quiet) console.log(...a);
  };
  const rootDir = path.resolve(o.srcDir);
  const store = new EventStore(o.dbPath ?? eventsDbPath());
  const cache = o.cachePath === null ? undefined : AiCache.open(o.cachePath ?? defaultCachePath());
  const stderr = new StderrBuffer(500);
  const app: AppProcess | undefined = o.appCommand?.length ? spawnApp(o.appCommand, stderr, o.appEnv) : undefined;

  // ---- live updates to the dashboard -----------------------------------------
  const sse = new Set<http.ServerResponse>();
  const broadcast = (obj: unknown) => {
    const data = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of sse) res.write(data);
  };
  const emitEvent = (id: string) => {
    const e = store.get(id);
    if (e) broadcast({ type: 'event', event: summary(e) });
  };

  let tunnelState: TunnelState | 'none' = o.relay ? 'connecting' : 'none';
  let aiState: Status['ai'] = { online: false };
  const publicUrl = o.relay ? makePublicUrl(o.relay) : null;
  const status = (): Status => ({ relay: tunnelState, ai: aiState, publicUrl, appPort: o.port, hasApp: !!app });
  const pushStatus = () => broadcast({ type: 'status', status: status() });

  const pollAi = async () => {
    const r = await checkAi(o.aiUrl);
    if (JSON.stringify(r) !== JSON.stringify(aiState)) {
      aiState = r;
      pushStatus();
    }
  };
  await pollAi();
  const aiTimer = setInterval(() => void pollAi(), o.aiPollMs ?? 5000);
  aiTimer.unref();

  // ---- diagnosis -------------------------------------------------------------
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => {
    inflight.add(p);
    void p.finally(() => inflight.delete(p)).catch(() => undefined);
    return p;
  };
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = chain.then(fn, fn);
    chain = r.catch(() => undefined);
    return r;
  };

  async function diagnoseEvent(id: string, opts: { delay?: number; startedAt?: number; force?: boolean }) {
    if (opts.delay) await sleep(opts.delay);
    const ev = store.get(id);
    if (!ev) return;
    if (opts.startedAt !== undefined) {
      const win = stderr.window(opts.startedAt - 50, Date.now());
      store.setStderr(id, win);
      ev.stderrWindow = win;
    }
    const prev = store.lastOk(ev.method, ev.path, ev.receivedAt, ev.id);
    const evidence: Evidence = {
      method: ev.method,
      path: ev.path,
      query: ev.query,
      status: ev.status,
      payload: ev.body,
      prevOkPayload: prev?.body,
      stderr: ev.stderrWindow ?? '',
      rootDir,
      connectionFailed: ev.connectionFailed,
    };
    const base = analyzeRules(evidence);
    store.setDiagnosis(id, { ...base, aiPending: true, hasAppProcess: !!app });
    emitEvent(id);
    const ai = await serial(() => runAi(evidence, base, { aiUrl: o.aiUrl, timeoutMs: o.aiTimeoutMs, cache, force: opts.force }));
    store.setDiagnosis(id, { ...base, ai, aiPending: false, hasAppProcess: !!app });
    emitEvent(id);
  }

  // ---- request handling ------------------------------------------------------
  interface Incoming {
    id: string;
    method: string;
    path: string;
    query: string;
    headers: Headers;
    body: Buffer;
    receivedAt: number;
    replayOf?: string;
  }

  async function processRequest(inc: Incoming): Promise<{ event: StoredEvent; result: ForwardResult }> {
    const startedAt = Date.now();
    const result = await forwardToLocal({
      port: o.port,
      method: inc.method,
      path: inc.path,
      query: inc.query,
      headers: inc.headers,
      body: inc.body,
    });
    const event: StoredEvent = {
      id: inc.id,
      receivedAt: inc.receivedAt,
      method: inc.method,
      path: inc.path,
      query: inc.query,
      headers: inc.headers,
      body: inc.body,
      status: result.status,
      respHeaders: result.headers,
      respBody: result.body,
      durationMs: result.durationMs,
      replayOf: inc.replayOf ?? null,
      stderrWindow: null,
      diagnosis: null,
      connectionFailed: result.connectionFailed,
    };
    store.insert(event);
    emitEvent(event.id);
    log(`${inc.replayOf ? '↻' : '←'} ${inc.method} ${inc.path} ${result.status} ${result.durationMs}ms`);
    if (failing(result.status, result.connectionFailed)) {
      void track(diagnoseEvent(event.id, { delay: 400, startedAt }).catch((e) => log('diagnosis failed:', (e as Error).message)));
    }
    return { event, result };
  }

  async function handleRelayRequest(msg: RelayRequest): Promise<RelayResponse> {
    const { result } = await processRequest({
      id: msg.eventId,
      method: msg.method,
      path: msg.path,
      query: msg.query,
      headers: msg.headers,
      body: Buffer.from(msg.bodyBase64, 'base64'),
      receivedAt: msg.receivedAt ?? Date.now(),
    });
    return {
      type: 'response',
      eventId: msg.eventId,
      status: result.status,
      headers: result.headers,
      bodyBase64: result.body.toString('base64'),
    };
  }

  async function replay(id: string) {
    const orig = store.get(id);
    if (!orig) return undefined;
    const { event } = await processRequest({
      id: randomUUID(),
      method: orig.method,
      path: orig.path,
      query: orig.query,
      headers: orig.headers,
      body: orig.body,
      receivedAt: Date.now(),
      replayOf: orig.id,
    });
    return {
      event: summary(event),
      originalStatus: orig.status,
      flipped: failing(orig.status, orig.connectionFailed) && !failing(event.status, event.connectionFailed),
    };
  }

  async function analyze(id: string, force = false) {
    const ev = store.get(id);
    if (!ev) return false;
    void track(diagnoseEvent(id, { force }).catch((e) => log('diagnosis failed:', (e as Error).message)));
    return true;
  }

  // ---- tunnel ----------------------------------------------------------------
  const tunnel = o.relay
    ? new TunnelClient({
        relay: o.relay.relay,
        id: o.relay.id,
        token: o.relay.token,
        onRequest: handleRelayRequest,
        onState: (s) => {
          tunnelState = s;
          log(s === 'connected' ? 'relay connected' : `relay ${s}`);
          pushStatus();
        },
      })
    : undefined;

  // ---- dashboard server (loopback only) ---------------------------------------
  const web = express();
  web.disable('x-powered-by');
  web.use((req, res, next) => {
    let originOk = true;
    if (req.headers.origin) {
      try {
        originOk = hostOk(new URL(req.headers.origin).host);
      } catch {
        originOk = false;
      }
    }
    if (!hostOk(req.headers.host) || !originOk) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });
  const htmlFile = fileURLToPath(new URL('../dashboard/index.html', import.meta.url));
  web.get('/', (_req, res) => {
    res.type('html').send(fs.readFileSync(htmlFile, 'utf8'));
  });
  web.get('/api/status', (_req, res) => void res.json(status()));
  web.get('/api/events', (_req, res) => void res.json(store.list().map(summary)));
  web.get('/api/events/:id', (req, res) => {
    const e = store.get(req.params.id);
    if (!e) res.status(404).json({ error: 'not found' });
    else res.json(detail(e));
  });
  web.get('/api/stream', (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`retry: 2000\ndata: ${JSON.stringify({ type: 'status', status: status() })}\n\n`);
    sse.add(res);
    const ka = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(ka);
      sse.delete(res);
    });
  });
  web.post('/api/replay/:id', async (req, res) => {
    const r = await replay(req.params.id);
    if (!r) res.status(404).json({ error: 'not found' });
    else res.json(r);
  });
  web.post('/api/analyze/:id', async (req, res) => {
    const ok = await analyze(req.params.id, req.query.force === '1' || req.query.force === 'true');
    if (!ok) res.status(404).json({ error: 'not found' });
    else res.status(202).json({ started: true });
  });

  const server = http.createServer(web);
  const boundPort = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.dashboardPort, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  tunnel?.start();

  return {
    store,
    stderr,
    dashboardPort: boundPort,
    dashboardUrl: `http://127.0.0.1:${boundPort}`,
    publicUrl,
    status,
    replay,
    analyze,
    async idle() {
      while (inflight.size) await Promise.allSettled([...inflight]);
    },
    async stop() {
      clearInterval(aiTimer);
      tunnel?.stop();
      app?.stop();
      for (const res of sse) res.end();
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections?.();
      });
      await Promise.race([Promise.allSettled([...inflight]), sleep(1500)]);
      cache?.close();
      store.close();
    },
  };
}
