import { addDays, parseYmd } from "../core/date.ts";
import type { Category, Plan } from "../core/types.ts";
import { CATEGORY_NAMES } from "../core/types.ts";

const CATEGORY_COLORS: Readonly<Record<Category, string>> = {
  study: "#8b6cf0",
  sport: "#34c759",
  life: "#ff9f0a",
};

export interface CategoryShare {
  readonly cat: Category;
  readonly name: string;
  readonly color: string;
  readonly total: number;
  readonly done: number;
}

function live(plans: readonly Plan[]): Plan[] {
  return plans.filter((p) => !p.deletedAt);
}

function inRange(p: Plan, from: string, to: string): boolean {
  return p.date >= from && p.date <= to;
}

/** Планы по отделам за период [from, to] включительно: сколько стоит и сколько выполнено. */
export function categoryShare(plans: readonly Plan[], from: string, to: string): CategoryShare[] {
  const cats: Category[] = ["study", "sport", "life"];
  return cats.map((cat) => {
    const items = live(plans).filter((p) => p.cat === cat && inRange(p, from, to));
    return { cat, name: CATEGORY_NAMES[cat], color: CATEGORY_COLORS[cat], total: items.length, done: items.filter((p) => p.done).length };
  });
}

/** Индекс дня недели: Пн = 0 … Вс = 6. */
export function weekdayIdx(date: string): number {
  return (parseYmd(date).getDay() + 6) % 7;
}

/**
 * В какие дни недели пользователь выполняет больше дел (за всю историю).
 * best — индекс лучшего дня или null, если выполненных ещё нет.
 */
export function weekdayProductivity(plans: readonly Plan[]): { counts: number[]; best: number | null } {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const p of live(plans)) {
    if (p.done) counts[weekdayIdx(p.date)]!++;
  }
  const max = Math.max(...counts);
  return { counts, best: max > 0 ? counts.indexOf(max) : null };
}

export interface WeekReport {
  readonly from: string; // понедельник
  readonly to: string; // воскресенье
  readonly total: number;
  readonly done: number;
  readonly pct: number;
  /** Выполнено на прошлой неделе и разница с ней. */
  readonly prevDone: number;
  readonly delta: number;
  /** Отдел, где выполнено больше всего (или null). */
  readonly topCategory: string | null;
}

/** Отчёт за неделю (Пн–Вс), в которую попадает день day. */
export function weeklyReport(plans: readonly Plan[], day: string): WeekReport {
  const from = addDays(day, -weekdayIdx(day));
  const to = addDays(from, 6);
  const prevFrom = addDays(from, -7);
  const prevTo = addDays(from, -1);
  const week = live(plans).filter((p) => inRange(p, from, to));
  const done = week.filter((p) => p.done).length;
  const prevDone = live(plans).filter((p) => p.done && inRange(p, prevFrom, prevTo)).length;
  const shares = categoryShare(plans, from, to);
  const top = shares.reduce<CategoryShare | null>((acc, s) => (s.done > 0 && (!acc || s.done > acc.done) ? s : acc), null);
  return {
    from,
    to,
    total: week.length,
    done,
    pct: week.length ? Math.round((done / week.length) * 100) : 0,
    prevDone,
    delta: done - prevDone,
    topCategory: top ? top.name : null,
  };
}
