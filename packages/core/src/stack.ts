export interface Frame {
  fn?: string;
  file: string;
  line: number;
  col: number;
  raw: string;
}

export interface ParsedTrace {
  /** The error line, e.g. "TypeError: Cannot read properties of undefined (reading 'login')". */
  errorMessage?: string;
  frames: Frame[];
  /** First frame that is not in node_modules and not node-internal. */
  frame?: Frame;
}

const FRAME_RE = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const ERROR_RE =
  /^\s*(?:Uncaught\s+)?((?:[A-Za-z_$][\w$.]*)?(?:Error|Exception)(?:\s*\[[^\]]+\])?(?::.*)?)$/;

export function isIgnoredFrame(file: string): boolean {
  return (
    /(^|[\\/])node_modules[\\/]/.test(file) ||
    file.startsWith('node:') ||
    file.includes('node:internal') ||
    file.startsWith('internal/') ||
    file.includes('<anonymous>')
  );
}

export function parseFrameLine(line: string): Frame | null {
  const m = FRAME_RE.exec(line);
  if (!m) return null;
  const [, fn, file, l, c] = m;
  return { fn: fn || undefined, file, line: Number(l), col: Number(c), raw: line.trim() };
}

interface Block {
  message?: string;
  frames: Frame[];
}

/**
 * Parse Node-style stack traces out of arbitrary stderr text. When several
 * traces are present the last one that has an application frame wins.
 */
export function parseStackTrace(stderrText: string): ParsedTrace {
  const blocks: Block[] = [];
  let cur: Block | undefined;
  for (const line of stderrText.split(/\r?\n/)) {
    const frame = parseFrameLine(line);
    if (frame) {
      if (!cur) {
        cur = { frames: [] };
        blocks.push(cur);
      }
      cur.frames.push(frame);
      continue;
    }
    const m = ERROR_RE.exec(line);
    if (m) {
      cur = { message: m[1].trim(), frames: [] };
      blocks.push(cur);
    }
  }
  const withUserFrame = [...blocks].reverse().find((b) => b.frames.some((f) => !isIgnoredFrame(f.file)));
  const withFrames = [...blocks].reverse().find((b) => b.frames.length > 0);
  const pick = withUserFrame ?? withFrames ?? blocks[blocks.length - 1];
  if (!pick) return { frames: [] };
  return {
    errorMessage: pick.message,
    frames: pick.frames,
    frame: pick.frames.find((f) => !isIgnoredFrame(f.file)),
  };
}
