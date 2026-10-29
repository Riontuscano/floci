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
`);

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

export const files = {
  insert: (row) => insertStmt.run(row),
  get: (id) => getStmt.get(id),
  delete: (id) => deleteStmt.run(id),
  stats: () => countStmt.get(),

  /** Keyset pagination: pass the last row's { created_at, id } as the cursor for the next page. */
  list: (limit, cursor) => cursor
    ? nextPageStmt.all(cursor.created_at, cursor.id, limit)
    : firstPageStmt.all(limit),
};

export function pingDb() {
  db.prepare('SELECT 1').get();
}
