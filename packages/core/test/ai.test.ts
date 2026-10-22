import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiCache, analyzeRules, askModel, cacheKey, checkAi, openDatabase, promptFor, runAi, type Evidence } from '../src/index.js';

// A stand-in for llama-server's OpenAI-compatible endpoint. Its answers exist only inside these tests
// and only ever land in an in-memory cache database.
let server: http.Server;
let url: string;
let calls = 0;
let lastBody: any;
let mode: 'ok' | 'slow' | 'error' = 'ok';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      calls++;
      lastBody = JSON.parse(Buffer.concat(chunks).toString());
      if (mode === 'error') {
        res.statusCode = 503;
        res.end('loading model');
        return;
      }
      const reply = () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: 'stub-model', choices: [{ message: { content: 'ROOT CAUSE: stub. FIX: stub.' } }] }));
      };
      if (mode === 'slow') setTimeout(reply, 1500);
      else reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const ev: Evidence = {
  method: 'POST',
  path: '/w',
  status: 500,
  payload: '{"customer":null}',
  prevOkPayload: '{"customer":{"email":"a"}}',
  stderr: "TypeError: Cannot read properties of null (reading 'email')\n    at h (/nowhere/h.ts:3:9)",
  rootDir: '/nowhere',
};

describe('askModel', () => {
  it('posts an OpenAI-style chat request with low temperature and a token cap', async () => {
    mode = 'ok';
    const r = await askModel({ system: 'sys', user: 'usr' }, { url: url + '/' });
    expect(r).toMatchObject({ text: 'ROOT CAUSE: stub. FIX: stub.', model: 'stub-model' });
    expect(lastBody).toMatchObject({ temperature: 0.1, max_tokens: 250 });
    expect(lastBody.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user']);
  });

  it('returns typed errors for http failures, timeouts and unreachable servers', async () => {
    mode = 'error';
    expect(await askModel({ system: 's', user: 'u' }, { url })).toMatchObject({ error: { kind: 'http' } });
    mode = 'slow';
    expect(await askModel({ system: 's', user: 'u' }, { url, timeoutMs: 200 })).toMatchObject({ error: { kind: 'timeout' } });
    expect(await askModel({ system: 's', user: 'u' }, { url: 'http://127.0.0.1:1', timeoutMs: 1000 })).toMatchObject({
      error: { kind: 'unreachable' },
    });
    mode = 'ok';
  });

  it('reports the model in checkAi', async () => {
    expect(await checkAi(url)).toEqual({ online: true, model: 'stub-model' });
    expect((await checkAi('http://127.0.0.1:1')).online).toBe(false);
  });
});

describe('runAi caching', () => {
  it('caches a real model answer by prompt hash, serves repeats without calling the model, and honours force', async () => {
    mode = 'ok';
    const cache = new AiCache(openDatabase(':memory:'));
    const base = analyzeRules(ev);
    calls = 0;
    const first = await runAi(ev, base, { aiUrl: url, cache });
    expect(first).toMatchObject({ text: expect.stringContaining('ROOT CAUSE') });
    expect('cached' in first && first.cached).toBeFalsy();
    expect(calls).toBe(1);
    expect(cache.get(cacheKey(promptFor(ev, base)))).toMatchObject({ model: 'stub-model' });

    const second = await runAi(ev, base, { aiUrl: url, cache });
    expect(second).toMatchObject({ cached: true });
    expect(calls).toBe(1);

    await runAi(ev, base, { aiUrl: url, cache, force: true });
    expect(calls).toBe(2);
  });

  it('never caches failures', async () => {
    mode = 'error';
    const cache = new AiCache(openDatabase(':memory:'));
    const base = analyzeRules(ev);
    expect(await runAi(ev, base, { aiUrl: url, cache })).toHaveProperty('error');
    expect(cache.get(cacheKey(promptFor(ev, base)))).toBeUndefined();
    mode = 'ok';
  });

  it('skips the model when the app was unreachable', async () => {
    calls = 0;
    const r = await runAi({ ...ev, connectionFailed: true }, analyzeRules(ev), { aiUrl: url });
    expect(r).toMatchObject({ error: { kind: 'skipped' } });
    expect(calls).toBe(0);
  });
});
