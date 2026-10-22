type Kind = 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean';

function kindOf(v: unknown): Kind {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'object') return 'object';
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'string';
}

interface Finding {
  rank: number;
  text: string;
}

const join = (p: string, k: string) => (p ? `${p}.${k}` : k);

function walk(prev: unknown, cur: unknown, p: string, out: Finding[]): void {
  const pk = kindOf(prev);
  const ck = kindOf(cur);
  const label = p || '(payload)';
  if (pk !== ck) {
    if (ck === 'null') {
      out.push({ rank: 1, text: `${label}: was ${pk} in last good payload, now null` });
    } else {
      out.push({ rank: 2, text: `${label}: was ${pk} in last good payload, now ${ck}` });
    }
    return;
  }
  if (pk === 'object') {
    const po = prev as Record<string, unknown>;
    const co = cur as Record<string, unknown>;
    for (const k of Object.keys(po)) {
      if (!(k in co)) {
        out.push({ rank: 0, text: `${join(p, k)}: present in last good payload (${kindOf(po[k])}), missing now` });
      } else {
        walk(po[k], co[k], join(p, k), out);
      }
    }
    for (const k of Object.keys(co)) {
      if (!(k in po)) out.push({ rank: 4, text: `${join(p, k)}: new key, not in last good payload` });
    }
  } else if (pk === 'array') {
    const pa = prev as unknown[];
    const ca = cur as unknown[];
    if (ca.length === 0 && pa.length > 0) {
      out.push({
        rank: 3,
        text: `${label}: was array with ${pa.length} item${pa.length === 1 ? '' : 's'} in last good payload, now an empty array`,
      });
    } else if (ca.length > 0 && pa.length > 0) {
      walk(pa[0], ca[0], `${p}[0]`, out);
    }
  }
}

function standalone(cur: unknown, p: string, out: Finding[]): void {
  const k = kindOf(cur);
  if (k === 'null') {
    out.push({ rank: 1, text: `${p || '(payload)'}: is null` });
  } else if (k === 'array') {
    const a = cur as unknown[];
    if (a.length === 0) out.push({ rank: 3, text: `${p || '(payload)'}: is an empty array` });
    else standalone(a[0], `${p}[0]`, out);
  } else if (k === 'object') {
    for (const [key, v] of Object.entries(cur as Record<string, unknown>)) standalone(v, join(p, key), out);
  }
}

export const NO_BASELINE = 'No earlier successful payload for this endpoint, so there is nothing to compare against.';

/**
 * Structural JSON diff between the last successful payload and the failing one.
 * Returns plain-English findings with JSON paths. Pass `undefined` for `prevOk`
 * when there is no earlier success.
 */
export function diffPayloads(prevOk: unknown, current: unknown, maxFindings = 20): string[] {
  const out: Finding[] = [];
  const hasPrev = prevOk !== undefined;
  if (hasPrev) walk(prevOk, current, '', out);
  else standalone(current, '', out);
  out.sort((a, b) => a.rank - b.rank);
  const texts = out.map((f) => f.text);
  const shown = texts.slice(0, maxFindings);
  if (texts.length > maxFindings) shown.push(`...and ${texts.length - maxFindings} more`);
  if (!hasPrev) return [NO_BASELINE, ...shown];
  if (shown.length === 0) return ['No structural differences from the last good payload (same keys and types).'];
  return shown;
}
