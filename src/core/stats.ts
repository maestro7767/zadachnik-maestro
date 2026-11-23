import { addDays, weekOf } from "./date.ts";
import type { Category, Plan } from "./types.ts";

/** Живые планы: удалённые (с tombstone) из статистики исключаются. */
function alive(plans: readonly Plan[]): Plan[] {
  return plans.filter((p) => !p.deletedAt);
}

/** Процент выполненных планов (0–100), округление до целого. */
export function completionPercent(plans: readonly Plan[]): number {
  const live = alive(plans);
  if (live.length === 0) return 0;
  const done = live.filter((p) => p.done).length;
  return Math.round((done / live.length) * 100);
}

/** Процент выполнения по одной категории. */
export function categoryPercent(plans: readonly Plan[], cat: Category): number {
  return completionPercent(alive(plans).filter((p) => p.cat === cat));
}

/**
 * Серия дней подряд с хотя бы одним выполненным планом.
 * Если сегодня ничего не выполнено, отсчёт идёт от вчерашнего дня:
 * серия не обнуляется до конца дня.
 */
export function streak(plans: readonly Plan[], today: string): number {
  const doneOn = (day: string): boolean => plans.some((p) => p.date === day && p.done && !p.deletedAt);
  let day = doneOn(today) ? today : addDays(today, -1);
  let n = 0;
  while (doneOn(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** Количество выполненных планов по дням недели (Пн–Вс) для недели anchor. */
export function weeklyDoneCounts(plans: readonly Plan[], anchor: string): number[] {
  return weekOf(anchor).map(
    (day) => plans.filter((p) => p.date === day && p.done && !p.deletedAt).length,
  );
}
