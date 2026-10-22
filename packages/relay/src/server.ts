import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { WebSocket, WebSocketServer } from 'ws';

export interface RelayOptions {
  dbPath?: string;
  /** Express "trust proxy" value, used for per-IP tunnel limits behind a load balancer. */
  trustProxy?: boolean | number | string;
  maxTunnelsPerIpPerDay?: number;
  rateLimitPerMin?: number;
  responseTimeoutMs?: number;
  retentionMs?: number;
  cleanupIntervalMs?: number;
  bodyLimit?: string;
}

export interface Relay {
  app: express.Express;
  server: http.Server;
  db: Database.Database;
  /** Resolves to the bound port (pass 0 for a random one). */
  start(port: number): Promise<number>;
  stop(): Promise<void>;
  isConnected(tunnelId: string): boolean;
}

interface Pending {
  socket: WebSocket;
  tunnelId: string;
  resolve: (r: TunnelResponse | 'timeout' | 'disconnected') => void;
  timer?: NodeJS.Timeout;
}

interface TunnelResponse {
  status: number;
  headers: Record<string, string | string[]>;
  bodyBase64: string;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'te', 'trailer']);
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const LANDING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LocalHook AI relay</title>
<style>body{font:16px/1.6 system-ui,sans-serif;background:#0f1218;color:#e6e9ef;max-width:640px;margin:48px auto;padding:0 20px}
code,pre{background:#1a2030;border-radius:6px;padding:2px 6px}pre{padding:12px;overflow:auto}h1{margin-bottom:0}small{color:#8b94a7}</style></head>
<body><h1>LocalHook AI relay</h1><small>Stable public webhook URLs that forward to your localhost.</small>
<h3>Quick start</h3>
<ol><li>Create a tunnel: <pre>npm run localhook -- init --relay https://THIS-HOST</pre></li>
<li>Run the agent next to your app: <pre>npm run localhook -- start --port 3000</pre></li>
<li>Point GitHub / Stripe / HubSpot at <code>https://THIS-HOST/h/&lt;your-id&gt;/your/path</code></li></ol>
<p><small>The relay stores events for 24 hours and authenticates tunnels with a token. AI analysis runs on your machine, not here.</small></p>
</body></html>`;

export function createRelay(opts: RelayOptions = {}): Relay {
  const {
    dbPath = process.env.DB_PATH || './relay.db',
    trustProxy = 1,
    maxTunnelsPerIpPerDay = 20,
    rateLimitPerMin = 60,
    responseTimeoutMs = 25_000,
    retentionMs = 24 * 3600_000,
    cleanupIntervalMs = 10 * 60_000,
    bodyLimit = '1mb',
  } = opts;

  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tunnels (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, ip TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, tunnel_id TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, query TEXT NOT NULL,
      headers TEXT NOT NULL, body BLOB NOT NULL, received_at INTEGER NOT NULL, status INTEGER, delivered INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_tunnel ON events (tunnel_id, received_at);
    CREATE INDEX IF NOT EXISTS tunnels_ip ON tunnels (ip, created_at);
  `);

  const q = {
    tunnel: db.prepare('SELECT id, token_hash FROM tunnels WHERE id = ?'),
    ipCount: db.prepare('SELECT COUNT(*) AS n FROM tunnels WHERE ip = ? AND created_at > ?'),
    addTunnel: db.prepare('INSERT INTO tunnels (id, token_hash, ip, created_at) VALUES (?, ?, ?, ?)'),
    addEvent: db.prepare(
      'INSERT INTO events (id, tunnel_id, method, path, query, headers, body, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    setResult: db.prepare('UPDATE events SET status = ?, delivered = ? WHERE id = ? AND tunnel_id = ?'),
    queued: db.prepare(
      'SELECT * FROM events WHERE tunnel_id = ? AND status IS NULL ORDER BY received_at, rowid',
    ),
    cleanup: db.prepare('DELETE FROM events WHERE received_at < ?'),
  };

  const sockets = new Map<string, WebSocket>();
  const pending = new Map<string, Pending>();
  const hits = new Map<string, number[]>();

  const allow = (id: string): boolean => {
    const now = Date.now();
    const arr = (hits.get(id) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= rateLimitPerMin) {
      hits.set(id, arr);
      return false;
    }
    arr.push(now);
    hits.set(id, arr);
    return true;
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/', (_req, res) => {
    res.type('html').send(LANDING);
  });

  app.post('/api/tunnels', express.json({ limit: '1kb' }), (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const since = Date.now() - 24 * 3600_000;
    const { n } = q.ipCount.get(ip, since) as { n: number };
    if (n >= maxTunnelsPerIpPerDay) {
      res.status(429).json({ error: `Tunnel limit reached (${maxTunnelsPerIpPerDay} per IP per day)` });
      return;
    }
    const id = crypto.randomBytes(9).toString('base64url');
    const token = crypto.randomBytes(24).toString('base64url');
    q.addTunnel.run(id, sha256(token), ip, Date.now());
    res.status(201).json({ id, token });
  });

  // ---- public webhook endpoint -------------------------------------------------
  type EventRow = {
    id: string;
    method: string;
    path: string;
    query: string;
    headers: string;
    body: Buffer;
    received_at: number;
  };

  const toMessage = (e: EventRow) => ({
    type: 'request' as const,
    eventId: e.id,
    method: e.method,
    path: e.path,
    query: e.query,
    headers: JSON.parse(e.headers) as Record<string, string | string[]>,
    bodyBase64: e.body.toString('base64'),
    receivedAt: e.received_at,
  });

  function waitFor(socket: WebSocket, tunnelId: string, eventId: string, withTimeout: boolean) {
    return new Promise<TunnelResponse | 'timeout' | 'disconnected'>((resolve) => {
      const p: Pending = { socket, tunnelId, resolve };
      if (withTimeout) {
        p.timer = setTimeout(() => {
          pending.delete(eventId);
          resolve('timeout');
        }, responseTimeoutMs);
      }
      pending.set(eventId, p);
    });
  }

  const publicHandler: express.RequestHandler = async (req, res) => {
    const id = req.params[0];
    const sub = req.params[1] || '/';
    if (!q.tunnel.get(id)) {
      res.status(404).json({ error: 'Unknown tunnel' });
      return;
    }
    if (!allow(id)) {
      res.status(429).json({ error: 'Rate limit exceeded (60 requests per minute per tunnel)' });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const qi = req.originalUrl.indexOf('?');
    const query = qi >= 0 ? req.originalUrl.slice(qi + 1) : '';
    const eventId = crypto.randomUUID();
    q.addEvent.run(eventId, id, req.method, sub, query, JSON.stringify(req.headers), body, Date.now());

    const sock = sockets.get(id);
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      res.status(202).json({ queued: true, eventId });
      return;
    }
    const msg = toMessage({
      id: eventId,
      method: req.method,
      path: sub,
      query,
      headers: JSON.stringify(req.headers),
      body,
      received_at: Date.now(),
    });
    const result = waitFor(sock, id, eventId, true);
    sock.send(JSON.stringify(msg));
    const r = await result;
    if (r === 'timeout') {
      q.setResult.run(504, 0, eventId, id);
      res.status(504).json({ error: 'Local app did not answer within 25s', eventId });
      return;
    }
    if (r === 'disconnected') {
      res.status(202).json({ queued: true, eventId });
      return;
    }
    for (const [k, v] of Object.entries(r.headers || {})) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      try {
        res.setHeader(k, v);
      } catch {
        /* ignore invalid header values from the local app */
      }
    }
    res.status(r.status >= 100 && r.status < 600 ? r.status : 502).end(Buffer.from(r.bodyBase64 || '', 'base64'));
  };
  app.all(/^\/h\/([^/]+)(\/.*)?$/, express.raw({ type: () => true, limit: bodyLimit }), publicHandler);

  app.use((err: Error & { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'Payload too large (limit 1MB)' });
      return;
    }
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: 'Bad request' });
  });

  // ---- tunnel websocket --------------------------------------------------------
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

  function flush(id: string, ws: WebSocket) {
    for (const row of q.queued.all(id) as EventRow[]) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (pending.has(row.id)) continue;
      void waitFor(ws, id, row.id, false);
      ws.send(JSON.stringify(toMessage(row)));
    }
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://relay');
    const id = url.searchParams.get('id') || '';
    const token = url.searchParams.get('token') || '';
    const t = url.pathname === '/tunnel' ? (q.tunnel.get(id) as { token_hash: string } | undefined) : undefined;
    const ok =
      !!t &&
      crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(t.token_hash));
    if (!ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const old = sockets.get(id);
      sockets.set(id, ws);
      if (old && old.readyState === WebSocket.OPEN) old.close(4000, 'replaced by a newer connection');
      let alive = true;
      ws.on('pong', () => {
        alive = true;
      });
      const ping = setInterval(() => {
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 20_000);
      ws.on('message', (data) => {
        let m: { type?: string; eventId?: string; status?: number; headers?: Record<string, string | string[]>; bodyBase64?: string };
        try {
          m = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (m.type !== 'response' || !m.eventId) return;
        const p = pending.get(m.eventId);
        if (p && p.tunnelId !== id) return;
        q.setResult.run(m.status ?? 502, 1, m.eventId, id);
        if (p) {
          if (p.timer) clearTimeout(p.timer);
          pending.delete(m.eventId);
          p.resolve({ status: m.status ?? 502, headers: m.headers ?? {}, bodyBase64: m.bodyBase64 ?? '' });
        }
      });
      ws.on('close', () => {
        clearInterval(ping);
        if (sockets.get(id) === ws) sockets.delete(id);
        for (const [eventId, p] of pending) {
          if (p.socket !== ws) continue;
          if (p.timer) clearTimeout(p.timer);
          pending.delete(eventId);
          p.resolve('disconnected');
        }
        const next = sockets.get(id);
        if (next) flush(id, next);
      });
      ws.on('error', () => ws.terminate());
      flush(id, ws);
    });
  });

  const cleanup = () => {
    q.cleanup.run(Date.now() - retentionMs);
    const now = Date.now();
    for (const [k, v] of hits) if (v.every((t) => now - t > 60_000)) hits.delete(k);
  };
  let cleanupTimer: NodeJS.Timeout | undefined;

  return {
    app,
    server,
    db,
    isConnected: (id) => sockets.get(id)?.readyState === WebSocket.OPEN,
    start(port) {
      cleanup();
      cleanupTimer = setInterval(cleanup, cleanupIntervalMs);
      cleanupTimer.unref();
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => resolve((server.address() as { port: number }).port));
      });
    },
    stop() {
      if (cleanupTimer) clearInterval(cleanupTimer);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections?.();
      });
    },
  };
}
