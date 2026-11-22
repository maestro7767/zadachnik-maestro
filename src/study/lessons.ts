import { parseYmd } from "../core/date.ts";
import type { Lesson } from "./model.ts";

/** Номер дня недели по дате: понедельник — 1, воскресенье — 7. */
export function isoWeekday(day: string): number {
  const d = parseYmd(day).getDay();
  return d === 0 ? 7 : d;
}

/** Занятия на дату, по времени начала. */
export function lessonsOn(lessons: readonly Lesson[], day: string): Lesson[] {
  const wd = isoWeekday(day);
  return lessons.filter((l) => l.weekday === wd).sort((a, b) => a.start.localeCompare(b.start));
}
