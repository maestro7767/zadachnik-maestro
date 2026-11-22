import { pad, ymd } from "../core/date.ts";
import type { Plan } from "../core/types.ts";

/** Текущая дата и время в формате, который понимает сравнение: YYYY-MM-DD и HH:MM. */
export interface NowParts {
  readonly today: string;
  readonly hm: string;
}

export function nowParts(d: Date): NowParts {
  return { today: ymd(d), hm: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export interface ReminderResult {
  /** Планы, о которых нужно напомнить сейчас, по возрастанию времени. */
  readonly due: Plan[];
  /** Обновлённый список уже напомненных планов. */
  readonly notified: string[];
}

/**
 * Выбирает планы, для которых пора показать напоминание.
 * Напоминание только для невыполненных планов с временем, наступившим сегодня,
 * и только один раз на каждый план.
 * Чистая функция: ничего не отправляет, сама решение об отправке принимает вызывающий код.
 */
export function dueReminders(
  plans: readonly Plan[],
  now: NowParts,
  notified: readonly string[],
): ReminderResult {
  const due = plans
    .filter(
      (p) =>
        !p.done &&
        p.date === now.today &&
        p.time !== "" &&
        p.time <= now.hm &&
        !notified.includes(p.id),
    )
    .sort((a, b) => a.time.localeCompare(b.time));
  return {
    due,
    notified: [...notified, ...due.map((p) => p.id)],
  };
}
