import { SCHEMA_VERSION, emptyAppData, emptyUserData, isPlan } from "./model.ts";
import type { AppData, UserData } from "./model.ts";
import type { Habit } from "../habits/habits.ts";
import type { WorkoutEntry } from "../sport/workouts.ts";
import { emptyStudy } from "../study/model.ts";

/** Минимальный интерфейс хранилища. В браузере это localStorage, в тестах — объект в памяти. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Приводит данные любой версии к текущему формату и отбрасывает испорченные записи. */
export function migrate(raw: unknown): AppData {
  if (typeof raw !== "object" || raw === null) return emptyAppData();
  const src = raw as Record<string, unknown>;

  const users: Record<string, string> = {};
  if (typeof src.users === "object" && src.users !== null) {
    for (const [login, hash] of Object.entries(src.users as Record<string, unknown>)) {
      if (typeof hash === "string") users[login] = hash;
    }
  }

  const data: Record<string, UserData> = {};
  if (typeof src.data === "object" && src.data !== null) {
    for (const [login, entry] of Object.entries(src.data as Record<string, unknown>)) {
      data[login] = sanitizeUser(entry);
    }
  }

  const session = typeof src.session === "string" && data[src.session] ? src.session : null;
  return { version: SCHEMA_VERSION, users, data, session };
}

function isHabit(v: unknown): v is Habit {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.id === "string" &&
    typeof h.name === "string" &&
    Array.isArray(h.doneDays) &&
    h.doneDays.every((d) => typeof d === "string")
  );
}

function isWorkout(v: unknown): v is WorkoutEntry {
  if (typeof v !== "object" || v === null) return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.id === "string" &&
    typeof w.date === "string" &&
    typeof w.exerciseId === "string" &&
    Array.isArray(w.sets) &&
    w.sets.every((s) => {
      if (typeof s !== "object" || s === null) return false;
      const set = s as Record<string, unknown>;
      return typeof set.weight === "number" && typeof set.reps === "number";
    })
  );
}

export function sanitizeUser(entry: unknown): UserData {
  const fallback = emptyUserData();
  if (typeof entry !== "object" || entry === null) return fallback;
  const e = entry as Record<string, unknown>;
  const notes = typeof e.notes === "object" && e.notes !== null ? (e.notes as Record<string, unknown>) : {};
  const plans = Array.isArray(e.plans) ? e.plans.filter(isPlan) : [];
  const habits = Array.isArray(e.habits) ? e.habits.filter(isHabit) : undefined;
  const workouts = Array.isArray(e.workouts) ? e.workouts.filter(isWorkout) : undefined;
  return {
    notes: {
      study: typeof notes.study === "string" ? notes.study : "",
      sport: typeof notes.sport === "string" ? notes.sport : "",
    },
    plans,
    ...(typeof e.profile === "object" && e.profile !== null ? { profile: e.profile as UserData["profile"] } : {}),
    ...(habits ? { habits } : {}),
    ...(workouts ? { workouts } : {}),
    ...(typeof e.study === "object" && e.study !== null
      ? { study: { ...emptyStudy(), ...(e.study as Partial<UserData["study"]>) } as UserData["study"] }
      : {}),
  };
}

/** Читает данные из хранилища. Если данных нет или они испорчены, возвращает пустое состояние. */
export function loadAppData(store: KeyValueStore, key: string): AppData {
  const text = store.getItem(key);
  if (text === null) return emptyAppData();
  try {
    return migrate(JSON.parse(text));
  } catch {
    return emptyAppData();
  }
}

/** Сохраняет данные. Возвращает false, если хранилище недоступно или переполнено. */
export function saveAppData(store: KeyValueStore, key: string, data: AppData): boolean {
  try {
    store.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
