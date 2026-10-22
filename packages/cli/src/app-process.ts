import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { StderrBuffer } from './stderr.js';

export interface AppProcess {
  child: ChildProcess;
  stop(): void;
}

/**
 * Run the user's app. stdout passes straight through; stderr is piped,
 * mirrored to the terminal, and recorded line-by-line in `buffer`.
 */
export function spawnApp(command: string[], buffer: StderrBuffer, env?: NodeJS.ProcessEnv): AppProcess {
  const child = spawn(command.join(' '), {
    shell: true,
    stdio: ['inherit', 'inherit', 'pipe'],
    env: { ...process.env, ...env },
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
    buffer.push(chunk);
  });
  child.on('close', () => buffer.flushPartial());
  return {
    child,
    stop() {
      if (child.exitCode !== null || !child.pid) return;
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    },
  };
}
