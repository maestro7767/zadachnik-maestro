import type { KeyValueStore } from "../data/storage.ts";
import type { EntityEntry } from "./diff.ts";

/**
 * Outbox — постоянная очередь локальных изменений, ожидающих отправки.
 * Переживает перезапуск приложения (хранится в localStorage): офлайн-правки
 * не теряются и уедут, когда появится сеть.
 */

function keyOf(e: Pick<EntityEntry, "coll" | "id">): string {
  return `${e.coll}${e.id}`;
}

export function loadOutbox(store: KeyValueStore, key: string): EntityEntry[] {
  try {
    const raw = store.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is EntityEntry =>
        typeof e === "object" && e !== null &&
        typeof (e as EntityEntry).coll === "string" &&
        typeof (e as EntityEntry).id === "string" &&
        typeof (e as EntityEntry).updatedAt === "string",
    );
  } catch {
    return [];
  }
}

export function saveOutbox(store: KeyValueStore, key: string, entries: readonly EntityEntry[]): void {
  try {
    store.setItem(key, JSON.stringify(entries));
  } catch {
    // Переполнение хранилища — изменения останутся в памяти движка и уедут позже.
  }
}

/**
 * Добавляет изменения в очередь. Повторное изменение той же сущности
 * заменяет прежнее — на сервер всегда уезжает только самая свежая версия.
 */
export function enqueue(entries: readonly EntityEntry[], changes: readonly EntityEntry[]): EntityEntry[] {
  const map = new Map(entries.map((e) => [keyOf(e), e]));
  for (const c of changes) {
    map.set(keyOf(c), c);
  }
  return [...map.values()];
}

/** Убирает из очереди подтверждённые сервером изменения. */
export function removeAcked(entries: readonly EntityEntry[], acked: readonly Pick<EntityEntry, "coll" | "id">[]): EntityEntry[] {
  const done = new Set(acked.map(keyOf));
  return entries.filter((e) => !done.has(keyOf(e)));
}
