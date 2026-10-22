export interface StderrLine {
  t: number;
  line: string;
}

/** Ring buffer of timestamped stderr lines (default: the last 500). */
export class StderrBuffer {
  private lines: StderrLine[] = [];
  private partial = '';

  constructor(private max = 500) {}

  /** Feed raw stream chunks; complete lines are timestamped as they arrive. */
  push(chunk: Buffer | string, now = Date.now()): void {
    const text = this.partial + chunk.toString();
    const parts = text.split(/\r?\n/);
    this.partial = parts.pop() ?? '';
    for (const line of parts) this.add(line, now);
  }

  add(line: string, t = Date.now()): void {
    this.lines.push({ t, line });
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  /** Flush a trailing line that never got a newline. */
  flushPartial(now = Date.now()): void {
    if (this.partial) {
      this.add(this.partial, now);
      this.partial = '';
    }
  }

  window(from: number, to: number): string {
    return this.lines
      .filter((l) => l.t >= from && l.t <= to)
      .map((l) => l.line)
      .join('\n');
  }

  get size(): number {
    return this.lines.length;
  }
}
