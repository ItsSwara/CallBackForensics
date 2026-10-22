import http from 'node:http';
import type { Headers } from './store.js';

export interface ForwardRequest {
  port: number;
  method: string;
  path: string;
  query?: string;
  headers: Headers;
  body: Buffer;
  timeoutMs?: number;
}

export interface ForwardResult {
  status: number;
  headers: Headers;
  body: Buffer;
  durationMs: number;
  /** The app never produced a response (refused / timed out / reset). */
  connectionFailed: boolean;
}

const DROP = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'proxy-connection']);

/** Same method/path/query/headers/raw bytes as the original call; only Host is rewritten. */
export function forwardToLocal(req: ForwardRequest): Promise<ForwardResult> {
  const started = Date.now();
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!DROP.has(k.toLowerCase())) headers[k] = v;
  }
  headers.host = `localhost:${req.port}`;
  if (req.body.length > 0 || !['GET', 'HEAD'].includes(req.method.toUpperCase())) headers['content-length'] = req.body.length;
  const fullPath = req.path + (req.query ? `?${req.query}` : '');

  return new Promise((resolve) => {
    const fail = (status: number, message: string): void =>
      resolve({
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: Buffer.from(message),
        durationMs: Date.now() - started,
        connectionFailed: true,
      });
    const r = http.request(
      { host: '127.0.0.1', port: req.port, method: req.method, path: fullPath, headers, timeout: req.timeoutMs ?? 20_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode || 502,
            headers: res.headers as Headers,
            body: Buffer.concat(chunks),
            durationMs: Date.now() - started,
            connectionFailed: false,
          }),
        );
        res.on('error', () => fail(502, 'Local app closed the connection mid-response'));
      },
    );
    r.on('timeout', () => {
      r.destroy();
      fail(504, `Your app on :${req.port} did not answer in time`);
    });
    r.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ECONNREFUSED') fail(502, `Your app is not running on :${req.port} (connection refused)`);
      else fail(502, `Could not reach your app on :${req.port}: ${e.message}`);
    });
    r.end(req.body);
  });
}
