import type { Plan } from "../core/types.ts";
import type { Habit } from "../habits/habits.ts";
import type { WorkoutEntry } from "../sport/workouts.ts";
import type { StudyData } from "../study/model.ts";

/** Текущая версия формата сохранённых данных. Растёт при каждом изменении структуры. */
export const SCHEMA_VERSION = 1;

export type Theme = "light" | "dark" | "system";

/** Настройки и профиль пользователя. Необязательные поля появились в более поздних версиях. */
export interface Profile {
  name: string;
  bio: string;
  showStats: boolean;
  accent: string;
  theme: Theme;
  notify: boolean;
  goal: number;
  workStart: string;
  workEnd: string;
  /** Идентификаторы планов, по которым уже показано напоминание. */
  notified?: string[];
  avatar?: string;
  cardPreset?: "gradient" | "dark" | "photo";
  cardPhoto?: string;
  /** Игровые элементы (уровни, испытания). false — выключены. */
  game?: boolean;
}

export interface Notes {
  study: string;
  sport: string;
}

/** Данные одного аккаунта на устройстве. */
export interface UserData {
  notes: Notes;
  plans: Plan[];
  profile?: Profile;
  habits?: Habit[];
  workouts?: WorkoutEntry[];
  study?: StudyData;
}

/** Всё, что приложение хранит в localStorage. */
export interface AppData {
  version: number;
  /** Логин → хеш пароля (или маркер "social:..." для входа через провайдера). */
  users: Record<string, string>;
  data: Record<string, UserData>;
  session: string | null;
}

export function emptyAppData(): AppData {
  return { version: SCHEMA_VERSION, users: {}, data: {}, session: null };
}

export function emptyUserData(): UserData {
  return { notes: { study: "", sport: "" }, plans: [] };
}

const CATEGORIES = ["study", "sport", "life"] as const;

/** Проверяет, что значение похоже на план. Используется при загрузке, чтобы не сломать приложение испорченными данными. */
export function isPlan(value: unknown): value is Plan {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.text === "string" &&
    typeof p.date === "string" &&
    typeof p.time === "string" &&
    typeof p.done === "boolean" &&
    typeof p.cat === "string" &&
    (CATEGORIES as readonly string[]).includes(p.cat)
  );
}
