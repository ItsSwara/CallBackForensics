import type { SourceLine } from './source.js';

export const SYSTEM_PROMPT =
  'You are a webhook debugging assistant. Use ONLY the evidence given. Do not invent files or lines. ' +
  'Answer in exactly this format:\nROOT CAUSE: <1-2 sentences>.\nFIX: <1-2 sentences>.\n' +
  'If the evidence is not enough, say what is missing.';

export const LIMITS = { payload: 1500, trace: 800, code: 1200, diff: 700, line: 160 };

export interface PromptEvidence {
  method: string;
  path: string;
  status: number | null;
  payload: string;
  diff: string[];
  errorMessage?: string;
  /** Pre-formatted stack frames (already relative paths). */
  trace?: string;
  code?: SourceLine[];
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 15)) + '…[truncated]';
}

function fmtLine(l: SourceLine): string {
  const body = l.text.length > LIMITS.line ? l.text.slice(0, LIMITS.line) + '…' : l.text;
  return `${l.highlight ? '>>' : '  '} ${String(l.n).padStart(4)} | ${body}`;
}

/** Keep the failing line and grow outward until the character budget is used. */
export function fitCode(lines: SourceLine[], max: number): string {
  if (lines.length === 0) return '';
  let idx = lines.findIndex((l) => l.highlight);
  if (idx < 0) idx = Math.floor(lines.length / 2);
  let lo = idx;
  let hi = idx;
  let used = fmtLine(lines[idx]).length;
  for (;;) {
    let grew = false;
    if (lo > 0) {
      const add = fmtLine(lines[lo - 1]).length + 1;
      if (used + add <= max) {
        lo--;
        used += add;
        grew = true;
      }
    }
    if (hi < lines.length - 1) {
      const add = fmtLine(lines[hi + 1]).length + 1;
      if (used + add <= max) {
        hi++;
        used += add;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return lines.slice(lo, hi + 1).map(fmtLine).join('\n');
}

export function compactPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

export function buildPrompt(ev: PromptEvidence): BuiltPrompt {
  const parts: string[] = [];
  parts.push(`REQUEST: ${ev.method} ${ev.path} -> HTTP ${ev.status ?? 'no response'}`);
  parts.push(`PAYLOAD:\n${truncate(compactPayload(ev.payload), LIMITS.payload) || '(empty body)'}`);
  const diff = ev.diff.map((d) => `- ${d}`).join('\n');
  parts.push(`PAYLOAD DIFF (rule-based, vs last successful payload):\n${truncate(diff, LIMITS.diff) || '(none)'}`);
  const errBits = [ev.errorMessage, ev.trace].filter(Boolean).join('\n');
  parts.push(`ERROR:\n${truncate(errBits, LIMITS.trace) || '(no stack trace captured)'}`);
  const code = ev.code && ev.code.length ? fitCode(ev.code, LIMITS.code) : '';
  parts.push(`FAILING CODE (>> marks the failing line):\n${code || '(source not available)'}`);
  return { system: SYSTEM_PROMPT, user: parts.join('\n\n') };
}
