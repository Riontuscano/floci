import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS files (
    id            TEXT PRIMARY KEY,
    storage_key   TEXT NOT NULL,
    original_name TEXT NOT NULL,
    content_type  TEXT NOT NULL,
    size          INTEGER NOT NULL,
    width         INTEGER,
    height        INTEGER,
    lqip          TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS files_created_at ON files (created_at DESC, id DESC);

  -- Transactional outbox: events are written in the same transaction as the change they
  -- describe, then published to SNS by a background dispatcher. An event can therefore never
  -- be lost between "file saved" and "event sent", even if SNS is down or the app crashes.
  CREATE TABLE IF NOT EXISTS outbox (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT
  );

  -- Written by the audit worker. The event id is the primary key, so a message delivered
  -- twice is stored once.
  CREATE TABLE IF NOT EXISTS audit_log (
    event_id    TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    file_id     TEXT,
    file_name   TEXT,
    size        INTEGER,
    client_ip   TEXT,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_log_occurred_at ON audit_log (occurred_at DESC);

  CREATE TABLE IF NOT EXISTS alerts (
    event_id    TEXT PRIMARY KEY,
    level       TEXT NOT NULL,
    message     TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS alerts_occurred_at ON alerts (occurred_at DESC);
`);

function transaction(work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const insertStmt = db.prepare(`
  INSERT INTO files (id, storage_key, original_name, content_type, size, width, height, lqip, created_at)
  VALUES (:id, :storage_key, :original_name, :content_type, :size, :width, :height, :lqip, :created_at)
`);
const getStmt = db.prepare('SELECT * FROM files WHERE id = ?');
const deleteStmt = db.prepare('DELETE FROM files WHERE id = ?');
const countStmt = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files');
const firstPageStmt = db.prepare('SELECT * FROM files ORDER BY created_at DESC, id DESC LIMIT ?');
const nextPageStmt = db.prepare(`
  SELECT * FROM files
  WHERE (created_at, id) < (?, ?)
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const outboxInsertStmt = db.prepare(
  'INSERT INTO outbox (id, type, payload, created_at) VALUES (:id, :type, :payload, :created_at)');
const outboxPendingStmt = db.prepare('SELECT * FROM outbox ORDER BY created_at LIMIT ?');
const outboxDeleteStmt = db.prepare('DELETE FROM outbox WHERE id = ?');
const outboxFailStmt = db.prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?');
const outboxCountStmt = db.prepare('SELECT COUNT(*) AS count FROM outbox');

const toOutboxRow = (event) => ({
  id: event.id,
  type: event.type,
  payload: JSON.stringify(event),
  created_at: event.time,
});

export const files = {
  get: (id) => getStmt.get(id),
  stats: () => countStmt.get(),

  /** Saves the file row and its "file.uploaded" event atomically. */
  insertWithEvent: (row, event) => transaction(() => {
    insertStmt.run(row);
    outboxInsertStmt.run(toOutboxRow(event));
  }),

  /** Deletes the file row and records its "file.deleted" event atomically. */
  deleteWithEvent: (id, event) => transaction(() => {
    deleteStmt.run(id);
    outboxInsertStmt.run(toOutboxRow(event));
  }),

  /** Keyset pagination: pass the last row's { created_at, id } as the cursor for the next page. */
  list: (limit, cursor) => cursor
    ? nextPageStmt.all(cursor.created_at, cursor.id, limit)
    : firstPageStmt.all(limit),
};

export const outbox = {
  pending: (limit) => outboxPendingStmt.all(limit),
  markPublished: (id) => outboxDeleteStmt.run(id),
  markFailed: (id, error) => outboxFailStmt.run(error, id),
  count: () => outboxCountStmt.get().count,
};

const auditInsertStmt = db.prepare(`
  INSERT OR IGNORE INTO audit_log (event_id, type, file_id, file_name, size, client_ip, occurred_at, recorded_at)
  VALUES (:event_id, :type, :file_id, :file_name, :size, :client_ip, :occurred_at, :recorded_at)
`);
const auditRecentStmt = db.prepare('SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT ?');

export const auditLog = {
  record: (row) => auditInsertStmt.run(row),
  recent: (limit) => auditRecentStmt.all(limit),
};

const alertInsertStmt = db.prepare(`
  INSERT OR IGNORE INTO alerts (event_id, level, message, occurred_at)
  VALUES (:event_id, :level, :message, :occurred_at)
`);
const alertRecentStmt = db.prepare('SELECT * FROM alerts ORDER BY occurred_at DESC LIMIT ?');

export const alerts = {
  record: (row) => alertInsertStmt.run(row),
  recent: (limit) => alertRecentStmt.all(limit),
};

export function pingDb() {
  db.prepare('SELECT 1').get();
}
