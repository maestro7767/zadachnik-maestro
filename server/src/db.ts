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
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    CREATE TABLE IF NOT EXISTS reminded (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      fired_at TEXT NOT NULL,
      PRIMARY KEY (user_id, plan_id)
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id),
      weekly_goal INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner','member')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS room_tasks (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      done_by TEXT,
      done_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_room_tasks ON room_tasks(room_id);
  `);
  // Миграция: колонка name появилась после первых баз.
  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "name")) {
    db.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  // Миграция: часовой пояс устройства для серверных напоминаний.
  const subCols = db.prepare("PRAGMA table_info(push_subscriptions)").all() as { name: string }[];
  if (!subCols.some((c) => c.name === "tz_offset")) {
    db.exec("ALTER TABLE push_subscriptions ADD COLUMN tz_offset INTEGER");
  }
  return db;
}
