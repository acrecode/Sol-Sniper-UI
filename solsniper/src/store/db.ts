import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../util/logger.js';

export type DB = Database.Database;

const MIGRATIONS: Array<{ id: number; sql: string }> = [
  {
    id: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS tokens (
      mint TEXT PRIMARY KEY,
      creator TEXT,
      source TEXT,
      name TEXT,
      symbol TEXT,
      status TEXT DEFAULT 'seen',      -- seen|evaluated|bought|skipped
      first_seen INTEGER,
      last_update INTEGER,
      state_json TEXT
    );

    CREATE TABLE IF NOT EXISTS safety_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT,
      rug_score INTEGER,
      verdict TEXT,
      checks_json TEXT,
      ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_safety_mint ON safety_reports(mint);

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      mint TEXT,
      source TEXT,
      entry_price REAL,
      current_price REAL,
      size_sol REAL,
      token_amount REAL,
      opened_at INTEGER,
      status TEXT,
      realized_pnl_sol REAL DEFAULT 0,
      high_water_price REAL,
      breakeven_armed INTEGER DEFAULT 0,
      first_tp_hit INTEGER DEFAULT 0,
      exit_snapshot_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pos_status ON positions(status);

    -- append-only trade ledger; no UPDATE/DELETE in code
    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY,
      position_id TEXT,
      mint TEXT,
      side TEXT,
      size_sol REAL,
      token_amount REAL,
      price REAL,
      signature TEXT,
      pnl_sol REAL,
      reason TEXT,
      mode TEXT,
      ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_mint ON ledger(mint);
    CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger(ts);

    CREATE TABLE IF NOT EXISTS configs (
      key TEXT PRIMARY KEY,
      value_json TEXT,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      data_json TEXT,
      ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
    `,
  },
];

export function openDb(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at INTEGER);`,
  );
  const applied = new Set(
    db
      .prepare('SELECT id FROM _migrations')
      .all()
      .map((r: any) => r.id as number),
  );

  const insert = db.prepare(
    'INSERT INTO _migrations (id, applied_at) VALUES (?, ?)',
  );
  const tx = db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      db.exec(m.sql);
      insert.run(m.id, Date.now());
      logger.info({ migration: m.id }, 'applied migration');
    }
  });
  tx();

  return db;
}
