import path from 'node:path';
import { askModel, isAiOk, type AiResult } from './ai.js';
import { AiCache, cacheKey } from './cache.js';
import { diffPayloads } from './diff.js';
import { oauthFindings } from './oauth.js';
import { buildPrompt, type BuiltPrompt } from './prompt.js';
import { readSourceContext, type SourceResult } from './source.js';
import { isIgnoredFrame, parseStackTrace, type Frame } from './stack.js';

export interface Evidence {
  method: string;
  path: string;
  /** Raw query string without the leading ?. */
  query?: string;
  status: number | null;
  payload?: Buffer | string;
  /** Body of the most recent successful request to the same method + path. */
  prevOkPayload?: Buffer | string;
  /** stderr lines captured while the request was being handled. */
  stderr: string;
  /** Source root: code outside it is never read. */
  rootDir: string;
  /** The app never answered (connection refused, timeout). */
  connectionFailed?: boolean;
  /** False when the CLI is not running the app (forward-only mode), so empty stderr proves nothing. Default true. */
  stderrCaptured?: boolean;
}

export interface RuleBased {
  ruleBased: string[];
  /** The failure is a routing problem; the model is not consulted. */
  routing?: boolean;
  frame?: Frame & { relPath?: string };
  snippet?: SourceResult;
  errorMessage?: string;
}

export interface Diagnosis extends RuleBased {
  ai?: AiResult;
}

const asText = (b?: Buffer | string) => (b === undefined ? undefined : typeof b === 'string' ? b : b.toString('utf8'));

function parseJson(text?: string): unknown {
  if (text === undefined || text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const routingFinding = (method: string, path: string, status: number | null) =>
  `No route matched ${method} ${path} on the local app (HTTP ${status ?? 'no response'}). ` +
  'This is a routing problem, not a payload problem. Check the path your provider is calling.';

/** Instant, model-free analysis. Always succeeds. */
export function analyzeRules(ev: Evidence): RuleBased {
  const ruleBased: string[] = [];
  const trace = parseStackTrace(ev.stderr);
  if (ev.connectionFailed) {
    ruleBased.push('The local app did not answer: connection refused or timed out. Check it is running on the expected port.');
  } else if (
    ev.status === 404 ||
    ev.status === 405 ||
    (ev.stderrCaptured !== false && ev.stderr.trim() === '' && !trace.frame)
  ) {
    return {
      ruleBased: [routingFinding(ev.method, ev.path, ev.status)],
      routing: true,
      errorMessage: trace.errorMessage,
    };
  }
  if (ev.query !== undefined && /^GET$/i.test(ev.method)) ruleBased.push(...oauthFindings(ev.path, ev.query));
  const payloadText = asText(ev.payload);
  const current = parseJson(payloadText);
  if (current === undefined) {
    if (payloadText) ruleBased.push('Payload is not valid JSON, so no structural comparison was possible.');
    else if (!/^(GET|HEAD)$/i.test(ev.method)) ruleBased.push('Request had no body.');
  } else {
    ruleBased.push(...diffPayloads(parseJson(asText(ev.prevOkPayload)), current));
  }
  let frame: RuleBased['frame'];
  let snippet: SourceResult | undefined;
  if (trace.frame) {
    snippet = readSourceContext(trace.frame.file, trace.frame.line, 10, ev.rootDir);
    frame = { ...trace.frame, relPath: snippet.ok ? snippet.relPath : undefined };
  }
  return { ruleBased, frame, snippet, errorMessage: trace.errorMessage };
}

/** Build the exact prompt the model sees (also the cache key input). */
export function promptFor(ev: Evidence, base: RuleBased): BuiltPrompt {
  const trace = parseStackTrace(ev.stderr);
  const rel = (file: string) => {
    if (base.frame && file === base.frame.file && base.frame.relPath) return base.frame.relPath;
    const plain = file.replace(/^file:\/\/\/?/, '');
    const r = path.relative(ev.rootDir, plain);
    return r.startsWith('..') || path.isAbsolute(r) ? path.basename(plain) : r.split(path.sep).join('/');
  };
  const userFrames = trace.frames
    .filter((f) => !isIgnoredFrame(f.file))
    .slice(0, 5)
    .map((f) => `  at ${f.fn ? f.fn + ' ' : ''}(${rel(f.file)}:${f.line}:${f.col})`)
    .join('\n');
  return buildPrompt({
    method: ev.method,
    path: ev.query ? `${ev.path}?${ev.query.slice(0, 300)}` : ev.path,
    status: ev.status,
    payload: asText(ev.payload) ?? '',
    diff: base.ruleBased,
    errorMessage: trace.errorMessage,
    trace: userFrames,
    code: base.snippet && base.snippet.ok ? base.snippet.lines : undefined,
  });
}

export interface AiOptions {
  aiUrl: string;
  timeoutMs?: number;
  cache?: AiCache;
  /** Skip the cache read (a fresh answer is still written back). */
  force?: boolean;
}

export async function runAi(ev: Evidence, base: RuleBased, opts: AiOptions): Promise<AiResult> {
  if (ev.connectionFailed) {
    return { error: { kind: 'skipped', message: 'No app response to analyze: the app was not reachable.' } };
  }
  if (base.routing) {
    return { error: { kind: 'skipped', message: 'Routing problem: no route matched, so there is nothing for the model to explain.' } };
  }
  const prompt = promptFor(ev, base);
  const key = cacheKey(prompt);
  if (opts.cache && !opts.force) {
    const hit = opts.cache.get(key);
    if (hit) return { ...hit, cached: true };
  }
  const res = await askModel(prompt, { url: opts.aiUrl, timeoutMs: opts.timeoutMs });
  // Only genuine model output is cached.
  if (isAiOk(res) && opts.cache) opts.cache.set(key, { text: res.text, model: res.model, ms: res.ms });
  return res;
}

/** Rule-based findings plus a local model explanation; degrades to rules only. */
export async function diagnose(ev: Evidence, opts: AiOptions): Promise<Diagnosis> {
  const base = analyzeRules(ev);
  const ai = await runAi(ev, base, opts);
  return { ...base, ai };
}
