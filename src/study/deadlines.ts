import { addDays } from "../core/date.ts";
import type { Deadline } from "./model.ts";

/** Сколько дней до срока: 0 — сегодня, отрицательное — срок прошёл. */
export function daysLeft(due: string, today: string): number {
  const [ty, tm, td] = today.split("-").map(Number);
  const [dy, dm, dd] = due.split("-").map(Number);
  const a = Date.UTC(ty as number, (tm as number) - 1, td as number);
  const b = Date.UTC(dy as number, (dm as number) - 1, dd as number);
  return Math.round((b - a) / 86_400_000);
}

/** Дедлайны от сегодня до days дней вперёд, по сроку. */
export function upcomingDeadlines(deadlines: readonly Deadline[], today: string, days = 14): Deadline[] {
  const end = addDays(today, days);
  return deadlines
    .filter((d) => d.due >= today && d.due <= end)
    .sort((a, b) => a.due.localeCompare(b.due));
}
