import type { UserData } from "../data/model.ts";
import { emptyStudy, type StudyData } from "../study/model.ts";
import { EPOCH, type EntityEntry } from "./diff.ts";

/**
 * Применение удалённых изменений к локальным данным по правилу LWW:
 * выигрывает больший updatedAt. Функции мутируют переданный data
 * (так устроен весь UI) и возвращают, было ли реальное изменение.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface StampedList {
  id: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

function listOf(data: UserData, coll: string): StampedList[] | null {
  switch (coll) {
    case "plans":
      return data.plans as StampedList[];
    case "habits":
      return ((data as Mutable<UserData>).habits ??= []) as StampedList[];
    case "workouts":
      return ((data as Mutable<UserData>).workouts ??= []) as StampedList[];
    case "subjects":
    case "assessments":
    case "lessons":
    case "deadlines":
    case "cards": {
      const d = data as Mutable<UserData>;
      if (!d.study) d.study = emptyStudy();
      return d.study[coll] as StampedList[];
    }
    default:
      return null;
  }
}

function isNewer(remote: string, local: string | undefined): boolean {
  return remote > (local ?? EPOCH);
}

function applyToList(list: StampedList[], change: EntityEntry): boolean {
  const idx = list.findIndex((x) => x.id === change.id);
  const local = idx >= 0 ? list[idx] : undefined;
  // Локальная версия строго новее — удалённое изменение проигрывает.
  // При равной метке применяем: это тот же снимок, запись идемпотентна.
  if (local && change.updatedAt < (local.updatedAt ?? EPOCH)) {
    return false;
  }
  if (change.deletedAt) {
    if (idx < 0) return false;
    // Жёсткое удаление: запись-тombstone локально хранить не нужно.
    list.splice(idx, 1);
    return true;
  }
  if (typeof change.payload !== "object" || change.payload === null) return false;
  const incoming = { ...(change.payload as Record<string, unknown>), id: change.id, updatedAt: change.updatedAt, deletedAt: null } as StampedList;
  if (idx >= 0) list.splice(idx, 1, incoming);
  else list.push(incoming);
  return true;
}

function applyStudyMeta(study: StudyData, change: EntityEntry): boolean {
  if (!isNewer(change.updatedAt, study.updatedAt) || typeof change.payload !== "object" || change.payload === null) {
    return false;
  }
  const p = change.payload as { institution?: StudyData["institution"]; secondYear?: boolean; attendance?: number };
  study.institution = p.institution ?? null;
  study.secondYear = p.secondYear === true;
  study.attendance = typeof p.attendance === "number" ? p.attendance : 0;
  study.updatedAt = change.updatedAt;
  return true;
}

/** Применяет одно удалённое изменение. Возвращает true, если данные изменились. */
export function applyRemoteChange(data: UserData, change: EntityEntry): boolean {
  if (change.coll === "notes") {
    if (change.deletedAt || !isNewer(change.updatedAt, data.notes.updatedAt)) return false;
    const p = change.payload as { study?: string; sport?: string } | null;
    if (typeof p !== "object" || p === null) return false;
    data.notes = { study: typeof p.study === "string" ? p.study : "", sport: typeof p.sport === "string" ? p.sport : "", updatedAt: change.updatedAt };
    return true;
  }
  if (change.coll === "profile") {
    if (change.deletedAt || !isNewer(change.updatedAt, data.profile?.updatedAt)) return false;
    if (typeof change.payload !== "object" || change.payload === null) return false;
    (data as Mutable<UserData>).profile = { ...(change.payload as object), updatedAt: change.updatedAt } as UserData["profile"];
    return true;
  }
  if (change.coll === "study_meta") {
    const d = data as Mutable<UserData>;
    if (!d.study) d.study = emptyStudy();
    return applyStudyMeta(d.study, change);
  }
  const list = listOf(data, change.coll);
  if (!list) return false;
  return applyToList(list, change);
}

/** Применяет пачку удалённых изменений. Возвращает true, если хоть одно что-то изменило. */
export function applyRemoteChanges(data: UserData, changes: readonly EntityEntry[]): boolean {
  let changed = false;
  for (const c of changes) {
    if (applyRemoteChange(data, c)) changed = true;
  }
  return changed;
}
