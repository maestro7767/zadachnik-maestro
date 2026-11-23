import type { UserData } from "../data/model.ts";

/**
 * Разворачивает данные пользователя в плоский список сущностей синхронизации
 * и считает разницу между снимками — это локальные изменения для отправки.
 */

/** Метка для сущностей из старых данных, у которых ещё нет updatedAt. */
export const EPOCH = "1970-01-01T00:00:00.000Z";

export interface EntityEntry {
  readonly coll: string;
  readonly id: string;
  readonly payload: unknown;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

interface Stamped {
  id?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

function entries(coll: string, items: readonly Stamped[] | undefined): EntityEntry[] {
  return (items ?? []).map((item) => ({
    coll,
    id: item.id ?? "",
    payload: item,
    updatedAt: item.updatedAt ?? EPOCH,
    deletedAt: item.deletedAt ?? null,
  }));
}

/** Плоский список всех сущностей пользователя: массивы + синглтоны notes/profile/study_meta. */
export function flattenUserData(data: UserData): EntityEntry[] {
  const out: EntityEntry[] = [];
  out.push(...entries("plans", data.plans));
  out.push(...entries("habits", data.habits));
  out.push(...entries("workouts", data.workouts));
  const s = data.study;
  if (s) {
    out.push(...entries("subjects", s.subjects));
    out.push(...entries("assessments", s.assessments));
    out.push(...entries("lessons", s.lessons));
    out.push(...entries("deadlines", s.deadlines));
    out.push(...entries("cards", s.cards));
    // Скалярные поля учёбы (заведение, курс, посещаемость) — отдельным синглтоном.
    if (s.institution !== null || s.updatedAt) {
      out.push({
        coll: "study_meta",
        id: "main",
        payload: { institution: s.institution, secondYear: s.secondYear, attendance: s.attendance, updatedAt: s.updatedAt },
        updatedAt: s.updatedAt ?? EPOCH,
        deletedAt: null,
      });
    }
  }
  out.push({ coll: "notes", id: "main", payload: data.notes, updatedAt: data.notes.updatedAt ?? EPOCH, deletedAt: null });
  if (data.profile) {
    out.push({ coll: "profile", id: "main", payload: data.profile, updatedAt: data.profile.updatedAt ?? EPOCH, deletedAt: null });
  }
  return out;
}

function keyOf(e: EntityEntry): string {
  return `${e.coll}${e.id}`;
}

/**
 * Разница между прошлым и текущим снимком: новые и изменённые сущности +
 * tombstones на исчезнувшие (реально удалённые, а не помеченные deletedAt).
 * nowIso — метка для tombstones.
 */
export function diffEntities(prev: readonly EntityEntry[], next: readonly EntityEntry[], nowIso: string): EntityEntry[] {
  const prevByKey = new Map(prev.map((e) => [keyOf(e), e]));
  const nextKeys = new Set(next.map(keyOf));
  const changes: EntityEntry[] = [];

  for (const n of next) {
    const p = prevByKey.get(keyOf(n));
    if (!p || p.updatedAt !== n.updatedAt || p.deletedAt !== n.deletedAt || JSON.stringify(p.payload) !== JSON.stringify(n.payload)) {
      changes.push(n);
    }
  }
  // Tombstones нужны только для сущностей, которых вообще нет в новом снимке.
  // Помеченные deletedAt уже входят в next и уехали как обычное изменение выше.
  for (const p of prev) {
    if (!nextKeys.has(keyOf(p)) && !p.deletedAt) {
      changes.push({ coll: p.coll, id: p.id, payload: null, updatedAt: nowIso, deletedAt: nowIso });
    }
  }
  return changes;
}
