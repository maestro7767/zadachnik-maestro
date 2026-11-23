import type { Plan } from "../core/types.ts";

/** Невыполненные планы на сегодня и просроченные, по дате и времени. */
export function unfinishedPlans(plans: readonly Plan[], today: string): Plan[] {
  return plans
    .filter((p) => !p.done && !p.deletedAt && p.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/**
 * Вечернее предложение перенести невыполненное: после конца рабочего дня,
 * не чаще одного раза в день и только если есть что переносить.
 * Без давления: «пропустить» гасит предложение до завтра.
 */
export function shouldOfferCarryover(
  nowHm: string,
  workEnd: string,
  today: string,
  plans: readonly Plan[],
  dismissedOn: string | null,
): boolean {
  if (dismissedOn === today) return false;
  if (nowHm < workEnd) return false;
  return unfinishedPlans(plans, today).length > 0;
}

/** Переносит выбранные планы на новую дату. Чистая функция: возвращает новый массив. */
export function movedPlans(plans: readonly Plan[], ids: readonly string[], newDate: string, nowIso: string): Plan[] {
  return plans.map((p) => (ids.includes(p.id) ? { ...p, date: newDate, updatedAt: nowIso } : p));
}
