/**
 * Тренировки: упражнения с подходами, вес в килограммах и повторения.
 * Веса тела и цели по весу не отслеживаются.
 */

/** Один подход: вес в кг и число повторений. */
export interface WorkoutSet {
  weight: number;
  reps: number;
}

export interface Exercise {
  readonly id: string;
  readonly name: string;
}

/** Запись тренировки: упражнение в конкретный день с подходами. */
export interface WorkoutEntry {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  exerciseId: string;
  sets: WorkoutSet[];
  /** Момент последнего изменения (ISO), для синхронизации. */
  updatedAt?: string;
  /** Момент удаления (ISO) — tombstone для синхронизации. */
  deletedAt?: string | null;
}

export const MAX_WEIGHT_KG = 500;
export const MAX_REPS = 100;

/** Стартовый список упражнений. Пользователь может добавлять свои. */
const DEFAULT_EXERCISES: readonly Exercise[] = [
  { id: "squat", name: "Приседания со штангой" },
  { id: "deadlift", name: "Становая тяга" },
  { id: "bench", name: "Жим лёжа" },
  { id: "ohp", name: "Жим стоя" },
  { id: "row", name: "Тяга штанги в наклоне" },
  { id: "pullup", name: "Подтягивания" },
  { id: "pushup", name: "Отжимания" },
  { id: "lunge", name: "Выпады" },
  { id: "plank", name: "Планка (секунды)" },
  { id: "curl", name: "Сгибания на бицепс" },
  { id: "press", name: "Жим гантелей" },
  { id: "dip", name: "Отжимания на брусьях" },
];

/** Подход корректен: вес от 0 до лимита, повторения целые от 1 до лимита. */
export function isValidSet(s: WorkoutSet): boolean {
  return (
    Number.isFinite(s.weight) &&
    s.weight >= 0 &&
    s.weight <= MAX_WEIGHT_KG &&
    Number.isInteger(s.reps) &&
    s.reps >= 1 &&
    s.reps <= MAX_REPS
  );
}

/** Объём подхода: вес × повторения. */
export function setVolume(s: WorkoutSet): number {
  return s.weight * s.reps;
}

/** Общий объём тренировки (сумма по подходам). */
export function workoutVolume(sets: readonly WorkoutSet[]): number {
  return sets.reduce((sum, s) => sum + setVolume(s), 0);
}

export interface ProgressPoint {
  readonly date: string;
  readonly maxWeight: number;
  readonly volume: number;
}

/**
 * Прогресс по одному упражнению: по каждому дню максимальный вес и общий объём.
 * Точки отсортированы по дате.
 */
export function exerciseProgress(entries: readonly WorkoutEntry[], exerciseId: string): ProgressPoint[] {
  const byDay = new Map<string, { maxWeight: number; volume: number }>();
  for (const e of entries) {
    if (e.exerciseId !== exerciseId || e.deletedAt) continue;
    const cur = byDay.get(e.date) ?? { maxWeight: 0, volume: 0 };
    for (const s of e.sets) {
      cur.maxWeight = Math.max(cur.maxWeight, s.weight);
      cur.volume += setVolume(s);
    }
    byDay.set(e.date, cur);
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({ date, maxWeight: v.maxWeight, volume: v.volume }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export { DEFAULT_EXERCISES };
