import type { Db } from "./db.ts";

/**
 * Коллекции синхронизации. Массивы сущностей совпадают с полями UserData/StudyData
 * клиента; синглтоны (notes, profile, study_meta) хранятся как коллекции
 * с фиксированным id "main".
 */
export const COLLECTIONS = [
  "plans",
  "habits",
  "workouts",
  "subjects",
  "assessments",
  "lessons",
  "deadlines",
  "cards",
  "notes",
  "profile",
  "study_meta",
] as const;

export type Collection = (typeof COLLECTIONS)[number];

/** Максимум изменений в одном push — защита от случайных гигантских пачек. */
export const MAX_PUSH_CHANGES = 500;
/** Максимальная длина id сущности. */
export const MAX_ID_LEN = 200;
/** Максимальный размер JSON одной сущности (символов). */
export const MAX_PAYLOAD_LEN = 100_000;

/** Одно изменение от клиента или к клиенту. Все метки времени — ISO UTC. */
export interface SyncChange {
  readonly coll: Collection;
  readonly id: string;
  /** JSON-объект сущности; у tombstone — null. */
  readonly payload: unknown;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export type ValidationResult = { ok: true; change: SyncChange } | { ok: false; error: string };

export function isCollection(value: unknown): value is Collection {
  return typeof value === "string" && (COLLECTIONS as readonly string[]).includes(value);
}

/**
 * Приводит строку к каноничному ISO UTC ("YYYY-MM-DDTHH:mm:ss.sssZ").
 * Возвращает null для невалидной даты. Каноничный формат делает
 * строковое сравнение меток корректным.
 */
export function normalizeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

interface EntityRow {
  payload: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Проверяет сырое значение из тела push и приводит его к SyncChange. */
export function validateChange(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_change" };
  const c = raw as Record<string, unknown>;
  if (!isCollection(c.coll)) return { ok: false, error: "unknown_collection" };
  if (typeof c.id !== "string" || c.id.length === 0 || c.id.length > MAX_ID_LEN) {
    return { ok: false, error: "invalid_id" };
  }
  const updatedAt = normalizeIso(c.updatedAt);
  if (!updatedAt) return { ok: false, error: "invalid_updated_at" };
  let deletedAt: string | null = null;
  if (c.deletedAt !== undefined && c.deletedAt !== null) {
    deletedAt = normalizeIso(c.deletedAt);
    if (!deletedAt) return { ok: false, error: "invalid_deleted_at" };
  }
  if (c.payload !== null && (typeof c.payload !== "object" || Array.isArray(c.payload))) {
    return { ok: false, error: "invalid_payload" };
  }
  if (JSON.stringify(c.payload ?? null).length > MAX_PAYLOAD_LEN) {
    return { ok: false, error: "payload_too_large" };
  }
  return { ok: true, change: { coll: c.coll, id: c.id, payload: c.payload ?? null, updatedAt, deletedAt } };
}

/**
 * Применяет изменение по правилу LWW: выигрывает больший updatedAt.
 * Возвращает "applied" или "skipped_stale" (равная метка тоже проигрывает —
 * повторная отправка того же изменения идемпотентна).
 */
export function applyChange(db: Db, userId: string, change: SyncChange): "applied" | "skipped_stale" {
  const existing = db
    .prepare("SELECT updated_at FROM entities WHERE user_id = ? AND coll = ? AND id = ?")
    .get(userId, change.coll, change.id) as { updated_at: string } | undefined;
  if (existing && existing.updated_at >= change.updatedAt) {
    return "skipped_stale";
  }
  db.prepare(
    `INSERT INTO entities (user_id, coll, id, payload, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, coll, id) DO UPDATE SET
       payload = excluded.payload,
       updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at`,
  ).run(userId, change.coll, change.id, JSON.stringify(change.payload), change.updatedAt, change.deletedAt);
  return "applied";
}

/**
 * Отдаёт все изменения пользователя с updated_at > since.
 * since = null — полная выгрузка (первый вход на новом устройстве).
 */
export function pullSince(db: Db, userId: string, since: string | null): SyncChange[] {
  const rows = (since === null
    ? db.prepare("SELECT coll, id, payload, updated_at, deleted_at FROM entities WHERE user_id = ? ORDER BY updated_at").all(userId)
    : db
        .prepare("SELECT coll, id, payload, updated_at, deleted_at FROM entities WHERE user_id = ? AND updated_at > ? ORDER BY updated_at")
        .all(userId, since)) as unknown as (EntityRow & { coll: string; id: string })[];
  return rows.map((r) => ({
    coll: r.coll as Collection,
    id: r.id,
    payload: JSON.parse(r.payload) as unknown,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  }));
}
