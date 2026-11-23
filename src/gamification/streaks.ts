import { addDays, mondayIndex, parseYmd } from "../core/date.ts";
import type { Plan } from "../core/types.ts";

export interface StreakReward {
  readonly days: number;
  readonly name: string;
}

const STREAK_REWARDS: readonly StreakReward[] = [
  { days: 3, name: "Огонёк" },
  { days: 7, name: "Неделя без пропусков" },
  { days: 14, name: "Две недели" },
  { days: 30, name: "Месяц" },
];

/** Награды, которые уже получены при данной серии. */
export function rewardsEarned(streak: number): StreakReward[] {
  return STREAK_REWARDS.filter((r) => streak >= r.days);
}

/** Первый день недели (понедельник), в которую попадает day. */
function weekKey(day: string): string {
  return addDays(day, -mondayIndex(parseYmd(day)));
}

/**
 * Серия с заморозкой: один пропущенный день в неделю не обнуляет серию,
 * если день перед пропуском выполнен. Пропуски подряд или второй пропуск в той же неделе
 * обрывают серию. Заморозка не добавляет дни к счёту, она только сохраняет серию.
 * Если сегодня ещё ничего не выполнено, отсчёт идёт от вчера.
 */
export function streakWithFreeze(plans: readonly Plan[], today: string): number {
  const doneOn = (day: string): boolean => plans.some((p) => p.date === day && p.done && !p.deletedAt);
  let day = doneOn(today) ? today : addDays(today, -1);
  let n = 0;
  const freezeUsedInWeek = new Set<string>();
  for (;;) {
    if (doneOn(day)) {
      n++;
      day = addDays(day, -1);
      continue;
    }
    const prev = addDays(day, -1);
    const week = weekKey(day);
    if (!freezeUsedInWeek.has(week) && doneOn(prev)) {
      freezeUsedInWeek.add(week);
      day = prev;
      continue;
    }
    break;
  }
  return n;
}

export { STREAK_REWARDS };
