import { addDays } from "../core/date.ts";

/** Один шаг разложенной цели: дата и что сделать. */
export interface PlanStep {
  readonly date: string;
  readonly text: string;
}

/** Сколько шагов максимум предлагаем за раз — больше уже давит, а не мотивирует. */
export const MAX_STEPS = 20;

/**
 * Локальное разложение цели без нейросети — запасной вариант на случай,
 * когда серверный ИИ недоступен (офлайн или ключ не настроен).
 * Равномерно размазывает занятия по дням до дедлайна, избегая перегруженных дней.
 */
export function decomposeLocally(
  goal: string,
  startDate: string,
  endDate: string,
  load: Readonly<Record<string, number>>,
  maxPerDay = 4,
): PlanStep[] {
  const days: string[] = [];
  let d = startDate;
  while (d <= endDate && days.length < 90) {
    days.push(d);
    d = addDays(d, 1);
  }
  if (days.length === 0) return [];
  const free = days.filter((x) => (load[x] ?? 0) < maxPerDay);
  const pool = free.length > 0 ? free : days;
  // 2..7 занятий: редко, но регулярно; на всю неделю — не чаще чем через день.
  const n = Math.min(Math.max(2, Math.ceil(pool.length / 2)), 7);
  const steps: PlanStep[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (pool.length - 1)) / Math.max(1, n - 1));
    steps.push({ date: pool[idx]!, text: `${goal} — занятие ${i + 1}/${n}` });
  }
  return steps;
}

/** Карта нагрузки: дата -> число невыполненных планов. Помогает ИИ и эвристике не перегружать дни. */
export function loadByDate(plans: readonly { date: string; done: boolean; deletedAt?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of plans) {
    if (p.done || p.deletedAt) continue;
    out[p.date] = (out[p.date] ?? 0) + 1;
  }
  return out;
}
