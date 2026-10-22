import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config {
  relay: string;
  id: string;
  token: string;
}

/** Directory for config + local event store. Override with LOCALHOOK_HOME. */
export const homeDir = () => process.env.LOCALHOOK_HOME || path.join(os.homedir(), '.localhook');
export const configPath = () => path.join(homeDir(), 'config.json');
export const eventsDbPath = () => path.join(homeDir(), 'events.db');
/** The AI cache is shared by every run so `demo:warm` can warm it for later. */
export const cachePath = () => process.env.LOCALHOOK_CACHE || path.join(os.homedir(), '.localhook', 'ai-cache.db');

export function loadConfig(): Config | null {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Config;
  } catch {
    return null;
  }
}

export function saveConfig(c: Config): void {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

export const publicUrl = (c: Pick<Config, 'relay' | 'id'>) => `${c.relay.replace(/\/+$/, '')}/h/${c.id}/`;
