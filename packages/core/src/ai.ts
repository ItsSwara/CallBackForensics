export type AiErrorKind = 'unreachable' | 'timeout' | 'http' | 'bad-response' | 'skipped';

export interface AiOk {
  text: string;
  ms: number;
  model: string;
  cached?: boolean;
}

export interface AiErr {
  error: { kind: AiErrorKind; message: string };
}

export type AiResult = AiOk | AiErr;

export const isAiOk = (r: AiResult | undefined | null): r is AiOk => !!r && 'text' in r;

export interface AskOptions {
  url: string;
  timeoutMs?: number;
  model?: string;
}

const base = (url: string) => url.replace(/\/+$/, '');

/** Ask an OpenAI-compatible chat completions endpoint (llama-server). */
export async function askModel(
  prompt: { system: string; user: string },
  { url, timeoutMs = 90_000, model = 'local' }: AskOptions,
): Promise<AiResult> {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base(url)}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 250,
        stream: false,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: { kind: 'http', message: `Model server returned HTTP ${res.status} ${body.slice(0, 200)}`.trim() } };
    }
    const json = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) return { error: { kind: 'bad-response', message: 'Model server returned no text' } };
    return { text, ms: Date.now() - started, model: json.model || model };
  } catch {
    if (ctl.signal.aborted) {
      return { error: { kind: 'timeout', message: `Model did not answer within ${Math.round(timeoutMs / 1000)}s` } };
    }
    return { error: { kind: 'unreachable', message: `Cannot reach model server at ${url}` } };
  } finally {
    clearTimeout(timer);
  }
}

/** Quick liveness probe used by the dashboard header and `doctor`. */
export async function checkAi(url: string, timeoutMs = 1500): Promise<{ online: boolean; model?: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base(url)}/v1/models`, { signal: ctl.signal });
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
      return { online: true, model: j.data?.[0]?.id };
    }
    const h = await fetch(`${base(url)}/health`, { signal: ctl.signal });
    return { online: h.ok };
  } catch {
    return { online: false };
  } finally {
    clearTimeout(timer);
  }
}
