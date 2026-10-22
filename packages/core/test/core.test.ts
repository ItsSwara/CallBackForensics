import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AiCache,
  analyzeRules,
  buildPrompt,
  cacheKey,
  diffPayloads,
  fitCode,
  LIMITS,
  NO_BASELINE,
  openDatabase,
  parseStackTrace,
  readSourceContext,
  routingFinding,
  runAi,
  type SourceLine,
} from '../src/index.js';

describe('parseStackTrace', () => {
  const trace = [
    "TypeError: Cannot read properties of undefined (reading 'login')",
    '    at handleGithub (C:\\proj\\handlers\\github-pr.ts:12:31)',
    '    at Layer.handle [as handle_request] (C:\\proj\\node_modules\\express\\lib\\router\\layer.js:95:5)',
    '    at node:internal/process/task_queues:95:5',
  ].join('\n');

  it('returns the message and the first application frame', () => {
    const t = parseStackTrace(trace);
    expect(t.errorMessage).toBe("TypeError: Cannot read properties of undefined (reading 'login')");
    expect(t.frame).toMatchObject({ fn: 'handleGithub', file: 'C:\\proj\\handlers\\github-pr.ts', line: 12, col: 31 });
    expect(t.frames).toHaveLength(3);
  });

  it('skips node_modules and node:internal frames', () => {
    const t = parseStackTrace(
      [
        'Error: boom',
        '    at /app/node_modules/express/lib/router/layer.js:95:5',
        '    at node:internal/modules/run_main:1:1',
        '    at file:///app/src/server.ts:7:11',
      ].join('\n'),
    );
    expect(t.frame?.file).toBe('file:///app/src/server.ts');
    expect(t.frame?.line).toBe(7);
  });

  it('parses "at file:line:col" without a function name and async frames', () => {
    const t = parseStackTrace('RangeError: x\n    at /srv/app.js:3:9\n    at async run (/srv/run.js:10:2)');
    expect(t.frames.map((f) => [f.fn, f.line])).toEqual([
      [undefined, 3],
      ['run', 10],
    ]);
    expect(t.frame?.file).toBe('/srv/app.js');
  });

  it('prefers the last trace that has an application frame', () => {
    const t = parseStackTrace(
      ['Error: first', '    at a (/srv/a.js:1:1)', 'noise', 'Error: second', '    at b (/srv/b.js:2:2)'].join('\n'),
    );
    expect(t.errorMessage).toBe('Error: second');
    expect(t.frame?.file).toBe('/srv/b.js');
  });

  it('returns no frame for text without a trace', () => {
    expect(parseStackTrace('listening on 3000')).toEqual({ frames: [] });
  });
});

describe('diffPayloads', () => {
  it('reports a type change with the JSON path', () => {
    const out = diffPayloads({ phone_number: 919876543210 }, { phone_number: '+91 98765 43210' });
    expect(out).toContain('phone_number: was number in last good payload, now string');
  });

  it('reports missing keys, nulls, empty arrays and new keys', () => {
    const prev = { pull_request: { user: { login: 'a' } }, customer: { email: 'x' }, items: [{ price: 1 }], a: 1 };
    const cur = { customer: null, items: [], extra: true, a: 1 };
    const out = diffPayloads(prev, cur);
    expect(out).toContain('pull_request: present in last good payload (object), missing now');
    expect(out).toContain('customer: was object in last good payload, now null');
    expect(out).toContain('items: was array with 1 item in last good payload, now an empty array');
    expect(out).toContain('extra: new key, not in last good payload');
  });

  it('recurses into nested objects and first array items', () => {
    const out = diffPayloads({ o: { items: [{ q: 1 }] } }, { o: { items: [{ q: '1' }] } });
    expect(out).toEqual(['o.items[0].q: was number in last good payload, now string']);
  });

  it('says so when there is no earlier success, flags empty arrays, but does not list nulls', () => {
    const out = diffPayloads(undefined, { customer: null, nested: { phone: null }, items: [] });
    expect(out[0]).toBe(NO_BASELINE);
    expect(out).toContain('items: is an empty array');
    expect(out.join(' | ')).not.toMatch(/null/);
  });

  it('still reports a field that turned null when a baseline exists', () => {
    expect(diffPayloads({ customer: { id: 1 } }, { customer: null })).toContain(
      'customer: was object in last good payload, now null',
    );
    expect(diffPayloads({ customer: null }, { customer: null })[0]).toMatch(/No structural differences/);
  });

  it('reports no differences for identical shapes', () => {
    expect(diffPayloads({ a: 1 }, { a: 2 })[0]).toMatch(/No structural differences/);
  });
});

describe('buildPrompt', () => {
  const lines = (n: number): SourceLine[] =>
    Array.from({ length: n }, (_, i) => ({ n: i + 1, text: 'const value = something(' + 'x'.repeat(60) + ')', highlight: i + 1 === 10 }));

  it('hard-truncates payload, trace, and code and stays compact', () => {
    const p = buildPrompt({
      method: 'POST',
      path: '/w',
      status: 500,
      payload: JSON.stringify({ blob: 'y'.repeat(10_000) }),
      diff: ['d: changed'],
      errorMessage: 'TypeError: nope',
      trace: ' at fn (a.ts:1:1)\n'.repeat(200),
      code: lines(80),
    });
    expect(p.user).toContain('[truncated]');
    const payloadSection = p.user.split('PAYLOAD DIFF')[0];
    expect(payloadSection.length).toBeLessThan(LIMITS.payload + 150);
    expect(p.user.length).toBeLessThan(6000);
  });

  it('marks the failing line with >> and keeps it when trimming', () => {
    const code = fitCode(lines(21), 300);
    expect(code).toMatch(/^>> +10 \|/m);
    expect(code.length).toBeLessThanOrEqual(300);
    expect(code.split('\n').length).toBeLessThan(21);
  });

  it('contains the four evidence sections and the strict system prompt', () => {
    const p = buildPrompt({ method: 'POST', path: '/w', status: 500, payload: '{}', diff: [], trace: '', code: [] });
    for (const s of ['PAYLOAD:', 'PAYLOAD DIFF', 'ERROR:', 'FAILING CODE']) expect(p.user).toContain(s);
    expect(p.system).toContain('ROOT CAUSE');
    expect(p.system).toContain('Use ONLY the evidence given');
  });
});

describe('readSourceContext', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-src-'));
  const file = path.join(root, 'h.ts');
  fs.writeFileSync(file, Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'));

  it('returns numbered lines around the failing line', () => {
    const r = readSourceContext(file, 15, 3, root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines.map((l) => l.n)).toEqual([12, 13, 14, 15, 16, 17, 18]);
      expect(r.lines.find((l) => l.highlight)?.text).toBe('line 15');
      expect(r.relPath).toBe('h.ts');
    }
  });

  it('resolves relative paths and file:// URLs', () => {
    expect(readSourceContext('h.ts', 2, 1, root).ok).toBe(true);
    const url = new URL('file:///' + file.replace(/\\/g, '/')).href;
    expect(readSourceContext(url, 2, 1, root).ok).toBe(true);
  });

  it('refuses to read outside the root (path traversal)', () => {
    const outside = path.join(os.tmpdir(), 'lh-outside.txt');
    fs.writeFileSync(outside, 'secret');
    for (const p of ['../lh-outside.txt', outside, path.join(root, '..', 'lh-outside.txt')]) {
      const r = readSourceContext(p, 1, 1, root);
      expect(r).toMatchObject({ ok: false, reason: 'outside-root' });
    }
  });

  it('reports missing files', () => {
    expect(readSourceContext('nope.ts', 1, 1, root)).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('diagnosis + cache', () => {
  const ev = {
    method: 'POST',
    path: '/w',
    status: 500,
    payload: JSON.stringify({ customer: null }),
    prevOkPayload: JSON.stringify({ customer: { email: 'a' } }),
    stderr: 'TypeError: Cannot read properties of null (reading \'email\')\n    at h (/nowhere/h.ts:3:9)',
    rootDir: os.tmpdir(),
  };

  it('returns rule-based findings with no model reachable, and caches nothing', async () => {
    const cache = new AiCache(openDatabase(':memory:'));
    const base = analyzeRules(ev);
    expect(base.ruleBased).toContain('customer: was object in last good payload, now null');
    expect(base.errorMessage).toContain('TypeError');
    const ai = await runAi(ev, base, { aiUrl: 'http://127.0.0.1:1', timeoutMs: 2000, cache });
    expect(ai).toHaveProperty('error');
    const key = cacheKey({ system: 'a', user: 'b' });
    expect(cache.get(key)).toBeUndefined();
  });
});

describe('routing problems', () => {
  const base = { method: 'POST', path: '/hooks/typo', payload: '{"a":1}', rootDir: os.tmpdir() };
  const trace = 'TypeError: boom\n    at h (/nowhere/h.ts:3:9)';

  it.each([404, 405])('reports a routing finding for HTTP %i and skips the payload diff', (status) => {
    const r = analyzeRules({ ...base, status, stderr: '', prevOkPayload: '{"a":"x"}' });
    expect(r.routing).toBe(true);
    expect(r.ruleBased).toEqual([
      `No route matched POST /hooks/typo on the local app (HTTP ${status}). This is a routing problem, not a payload problem. Check the path your provider is calling.`,
    ]);
    expect(r.ruleBased[0]).toBe(routingFinding('POST', '/hooks/typo', status));
  });

  it('treats 404 as routing even when stderr has a trace', () => {
    expect(analyzeRules({ ...base, status: 404, stderr: trace }).routing).toBe(true);
  });

  it('reports routing when there is no stderr and no stack frame', () => {
    const r = analyzeRules({ ...base, status: 500, stderr: '  \n' });
    expect(r.routing).toBe(true);
    expect(r.ruleBased[0]).toContain('(HTTP 500)');
  });

  it('is not a routing problem when a stack frame exists', () => {
    const r = analyzeRules({ ...base, status: 500, stderr: trace });
    expect(r.routing).toBeUndefined();
    expect(r.frame?.line).toBe(3);
  });

  it('does not claim routing when stderr is not captured (forward-only) or the app was unreachable', () => {
    expect(analyzeRules({ ...base, status: 500, stderr: '', stderrCaptured: false }).routing).toBeUndefined();
    const conn = analyzeRules({ ...base, status: 502, stderr: '', connectionFailed: true });
    expect(conn.routing).toBeUndefined();
    expect(conn.ruleBased[0]).toMatch(/did not answer/);
  });

  it('never calls the model for a routing problem', async () => {
    let called = 0;
    const server = http.createServer((_req, res) => {
      called++;
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const aiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const cache = new AiCache(openDatabase(':memory:'));
      for (const ev of [
        { ...base, status: 404, stderr: '' },
        { ...base, status: 500, stderr: '' },
      ]) {
        const r = await runAi(ev, analyzeRules(ev), { aiUrl, cache });
        expect(r).toMatchObject({ error: { kind: 'skipped' } });
      }
      expect(called).toBe(0);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
