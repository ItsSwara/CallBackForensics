import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceLine {
  n: number;
  text: string;
  highlight: boolean;
}

export type SourceResult =
  | { ok: true; file: string; relPath: string; startLine: number; endLine: number; lines: SourceLine[] }
  | { ok: false; reason: 'outside-root' | 'not-found' | 'unreadable'; message: string };

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Read `radius` lines either side of `line`. Refuses to read outside `rootDir`. */
export function readSourceContext(
  file: string,
  line: number,
  radius = 10,
  rootDir: string = process.cwd(),
): SourceResult {
  let resolved: string;
  try {
    resolved = file.startsWith('file://') ? fileURLToPath(file) : path.resolve(rootDir, file);
  } catch {
    return { ok: false, reason: 'unreadable', message: `Cannot resolve path ${file}` };
  }
  const root = path.resolve(rootDir);
  if (!inside(root, resolved)) {
    return { ok: false, reason: 'outside-root', message: 'Refusing to read a file outside the source root' };
  }
  let realFile: string;
  try {
    realFile = fs.realpathSync(resolved);
  } catch {
    return { ok: false, reason: 'not-found', message: `Source file not found: ${resolved}` };
  }
  let realRoot = root;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    /* root missing: the containment check below will fail */
  }
  if (!inside(realRoot, realFile)) {
    return { ok: false, reason: 'outside-root', message: 'Refusing to read a file outside the source root' };
  }
  let text: string;
  try {
    text = fs.readFileSync(realFile, 'utf8');
  } catch (e) {
    return { ok: false, reason: 'unreadable', message: (e as Error).message };
  }
  const all = text.split(/\r?\n/);
  const startLine = Math.max(1, line - radius);
  const endLine = Math.min(all.length, line + radius);
  const lines: SourceLine[] = [];
  for (let n = startLine; n <= endLine; n++) {
    lines.push({ n, text: all[n - 1] ?? '', highlight: n === line });
  }
  return {
    ok: true,
    file: realFile,
    relPath: path.relative(realRoot, realFile).split(path.sep).join('/'),
    startLine,
    endLine,
    lines,
  };
}
