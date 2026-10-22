import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(file: string): Database.Database {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  return db;
}

export function cacheKey(prompt: { system: string; user: string }): string {
  return crypto.createHash('sha256').update(prompt.system).update('\n').update(prompt.user).digest('hex');
}

export interface CachedAnswer {
  text: string;
  model: string;
  ms: number;
}

/**
 * Maps sha256(prompt) -> model output. Only answers that came back from a model
 * server are ever written (see diagnose.ts); nothing is pre-seeded.
 */
export class AiCache {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_cache (
      key TEXT PRIMARY KEY, text TEXT NOT NULL, model TEXT NOT NULL, ms INTEGER NOT NULL, created_at INTEGER NOT NULL
    )`);
  }

  static open(file: string): AiCache {
    return new AiCache(openDatabase(file));
  }

  get(key: string): CachedAnswer | undefined {
    return this.db.prepare('SELECT text, model, ms FROM ai_cache WHERE key = ?').get(key) as CachedAnswer | undefined;
  }

  set(key: string, v: CachedAnswer): void {
    this.db
      .prepare('INSERT OR REPLACE INTO ai_cache (key, text, model, ms, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(key, v.text, v.model, v.ms, Date.now());
  }

  close(): void {
    this.db.close();
  }
}
