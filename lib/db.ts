import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data');

let dbInstance: Database.Database | null = null;
let openPath: string | null = null;

function databasePath(): string {
  return process.env.JEOPARDY_DB_PATH || path.join(DEFAULT_DATA_DIR, 'jeopardy.db');
}

export function getDb(): Database.Database {
  const targetPath = databasePath();
  if (dbInstance && openPath === targetPath) return dbInstance;

  if (dbInstance) dbInstance.close();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  dbInstance = new Database(targetPath);
  openPath = targetPath;
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  initializeSchema(dbInstance);
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) dbInstance.close();
  dbInstance = null;
  openPath = null;
}

function addColumn(
  db: Database.Database,
  table: string,
  columns: Set<string>,
  name: string,
  definition: string,
): void {
  if (columns.has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  columns.add(name);
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      email TEXT UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      board_data TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      ai_provider TEXT,
      ai_model TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      schema_version INTEGER NOT NULL DEFAULT 1,
      revision INTEGER NOT NULL DEFAULT 1,
      last_opened_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const userColumns = new Set(
    (db.pragma('table_info(users)') as { name: string }[]).map(({ name }) => name),
  );
  addColumn(db, 'users', userColumns, 'email', 'TEXT COLLATE NOCASE');
  addColumn(db, 'users', userColumns, 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', userColumns, 'updated_at', "TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
  addColumn(db, 'users', userColumns, 'last_login_at', 'TEXT');

  const boardColumns = new Set(
    (db.pragma('table_info(boards)') as { name: string }[]).map(({ name }) => name),
  );
  addColumn(db, 'boards', boardColumns, 'source', "TEXT NOT NULL DEFAULT 'manual'");
  addColumn(db, 'boards', boardColumns, 'ai_provider', 'TEXT');
  addColumn(db, 'boards', boardColumns, 'ai_model', 'TEXT');
  addColumn(db, 'boards', boardColumns, 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, 'boards', boardColumns, 'schema_version', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'boards', boardColumns, 'revision', 'INTEGER NOT NULL DEFAULT 1');
  addColumn(db, 'boards', boardColumns, 'last_opened_at', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_boards_user_id ON boards(user_id);
    CREATE INDEX IF NOT EXISTS idx_boards_user_updated
      ON boards(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_boards_user_source
      ON boards(user_id, source);
  `);
}
