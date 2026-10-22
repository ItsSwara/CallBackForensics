import type Database from 'better-sqlite3';
import { openDatabase, type Diagnosis } from '@localhook/core';

export type Headers = Record<string, string | string[]>;

export interface StoredDiagnosis extends Diagnosis {
  aiPending?: boolean;
  hasAppProcess?: boolean;
}

export interface StoredEvent {
  id: string;
  receivedAt: number;
  method: string;
  path: string;
  query: string;
  headers: Headers;
  body: Buffer;
  status: number | null;
  respHeaders: Headers;
  respBody: Buffer;
  durationMs: number | null;
  replayOf: string | null;
  stderrWindow: string | null;
  diagnosis: StoredDiagnosis | null;
  connectionFailed: boolean;
}

interface Row {
  id: string;
  received_at: number;
  method: string;
  path: string;
  query: string;
  headers: string;
  body: Buffer;
  status: number | null;
  resp_headers: string | null;
  resp_body: Buffer | null;
  duration_ms: number | null;
  replay_of: string | null;
  stderr_window: string | null;
  diagnosis: string | null;
  conn_failed: number;
}

const fromRow = (r: Row): StoredEvent => ({
  id: r.id,
  receivedAt: r.received_at,
  method: r.method,
  path: r.path,
  query: r.query,
  headers: JSON.parse(r.headers),
  body: r.body,
  status: r.status,
  respHeaders: r.resp_headers ? JSON.parse(r.resp_headers) : {},
  respBody: r.resp_body ?? Buffer.alloc(0),
  durationMs: r.duration_ms,
  replayOf: r.replay_of,
  stderrWindow: r.stderr_window,
  diagnosis: r.diagnosis ? JSON.parse(r.diagnosis) : null,
  connectionFailed: !!r.conn_failed,
});

export class EventStore {
  private db: Database.Database;

  constructor(file: string, keep = 1000) {
    this.db = openDatabase(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, query TEXT NOT NULL,
      headers TEXT NOT NULL, body BLOB NOT NULL, status INTEGER, resp_headers TEXT, resp_body BLOB, duration_ms INTEGER,
      replay_of TEXT, stderr_window TEXT, diagnosis TEXT, conn_failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS events_route ON events (method, path, status, received_at);`);
    this.db
      .prepare('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY received_at DESC, rowid DESC LIMIT ?)')
      .run(keep);
  }

  insert(e: StoredEvent): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO events (id, received_at, method, path, query, headers, body, status, resp_headers, resp_body,
         duration_ms, replay_of, stderr_window, diagnosis, conn_failed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.id,
        e.receivedAt,
        e.method,
        e.path,
        e.query,
        JSON.stringify(e.headers),
        e.body,
        e.status,
        JSON.stringify(e.respHeaders),
        e.respBody,
        e.durationMs,
        e.replayOf,
        e.stderrWindow,
        e.diagnosis ? JSON.stringify(e.diagnosis) : null,
        e.connectionFailed ? 1 : 0,
      );
  }

  setStderr(id: string, window: string): void {
    this.db.prepare('UPDATE events SET stderr_window = ? WHERE id = ?').run(window, id);
  }

  setDiagnosis(id: string, d: StoredDiagnosis): void {
    this.db.prepare('UPDATE events SET diagnosis = ? WHERE id = ?').run(JSON.stringify(d), id);
  }

  get(id: string): StoredEvent | undefined {
    const r = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  /** Newest first, without heavy columns. */
  list(limit = 300): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events ORDER BY received_at DESC, rowid DESC LIMIT ?')
      .all(limit) as Row[];
    return rows.map(fromRow);
  }

  /** Most recent 2xx for the same method + path that arrived before `before`. */
  lastOk(method: string, path: string, before: number, excludeId: string): StoredEvent | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM events WHERE method = ? AND path = ? AND status >= 200 AND status < 300 AND id != ?
         AND received_at <= ? ORDER BY received_at DESC, rowid DESC LIMIT 1`,
      )
      .get(method, path, excludeId, before) as Row | undefined;
    return r ? fromRow(r) : undefined;
  }

  close(): void {
    this.db.close();
  }
}
