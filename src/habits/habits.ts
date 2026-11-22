import { addDays, mondayIndex, parseYmd } from "../core/date.ts";

/** Привычка. Отметки хранятся списком дат, на которые она выполнена. */
export interface Habit {
  id: string;
  name: string;
  /** Даты выполнения, YYYY-MM-DD, по возрастанию. */
  doneDays: string[];
}

/** Добавляет или убирает отметку за день. Возвращает новый список, исходный не меняется. */
export function toggleDay(doneDays: readonly string[], day: string): string[] {
  return doneDays.includes(day)
    ? doneDays.filter((d) => d !== day)
    : [...doneDays, day].sort();
}

/** Первый день недели (понедельник), в которую попадает day. */
function weekKey(day: string): string {
  return addDays(day, -mondayIndex(parseYmd(day)));
}

/**
 * Серия привычки с заморозкой: один пропуск в неделю не обнуляет серию,
 * если день перед пропуском выполнен. Логика та же, что у серии планов.
 * Если сегодня ещё не отмечено, отсчёт идёт от вчера.
 */
export function habitStreak(doneDays: readonly string[], today: string): number {
  const done = new Set(doneDays);
  let day = done.has(today) ? today : addDays(today, -1);
  let n = 0;
  const freezeUsed = new Set<string>();
  for (;;) {
    if (done.has(day)) {
      n++;
      day = addDays(day, -1);
      continue;
    }
    const prev = addDays(day, -1);
    const week = weekKey(day);
    if (!freezeUsed.has(week) && done.has(prev)) {
      freezeUsed.add(week);
      day = prev;
      continue;
    }
    break;
  }
  return n;
}

/** Выполнено ли за сегодня. */
export function isDoneOn(doneDays: readonly string[], day: string): boolean {
  return doneDays.includes(day);
}
