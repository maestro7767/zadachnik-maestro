import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Открывает базу и гарантирует схему. ":memory:" — для тестов.
 * Используем встроенный node:sqlite (Node 24+): без нативных зависимостей,
 * одинаково работает локально, в CI и на сервере.
 * WAL: чтение не блокирует запись, важно для синхронизации с нескольких устройств.
 */
export function openDb(path = ":memory:"): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
    CREATE TABLE IF NOT EXISTS entities (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coll TEXT NOT NULL,
      id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (user_id, coll, id)
    );
    CREATE INDEX IF NOT EXISTS idx_entities_pull ON entities(user_id, updated_at);
  `);
  // Миграция: колонка name появилась после первых баз.
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "name")) {
    db.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  return db;
}
