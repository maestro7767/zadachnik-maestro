import { addDays } from "../core/date.ts";
import type { Plan } from "../core/types.ts";

/** Контекст проверки: день и все планы пользователя. */
export interface ChallengeContext {
  readonly day: string;
  readonly plans: readonly Plan[];
}

export interface Challenge {
  readonly id: string;
  readonly title: string;
  readonly xp: number;
  readonly check: (c: ChallengeContext) => boolean;
}

const dayPlans = (ctx: ChallengeContext): Plan[] => ctx.plans.filter((p) => p.date === ctx.day && !p.deletedAt);

const CHALLENGES: readonly Challenge[] = [
  { id: "two", title: "Выполни 2 плана", xp: 15, check: (c) => dayPlans(c).filter((p) => p.done).length >= 2 },
  { id: "sport", title: "Выполни план в отделе «Спорт»", xp: 10, check: (c) => dayPlans(c).some((p) => p.done && p.cat === "sport") },
  { id: "study", title: "Выполни план в отделе «Учёба»", xp: 10, check: (c) => dayPlans(c).some((p) => p.done && p.cat === "study") },
  { id: "timed", title: "Выполни план с временем", xp: 10, check: (c) => dayPlans(c).some((p) => p.done && p.time !== "") },
  { id: "tomorrow", title: "Запланируй план на завтра", xp: 10, check: (c) => c.plans.some((p) => p.date === addDays(c.day, 1) && !p.deletedAt) },
  { id: "all", title: "Закрой все планы дня", xp: 20, check: (c) => dayPlans(c).length > 0 && dayPlans(c).every((p) => p.done) },
];

/** Простой детерминированный хеш строки (для выбора испытаний по дате). */
function hashDay(day: string): number {
  let h = 0;
  for (const ch of day) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/**
 * Три испытания на день. Одинаковы для всех пользователей: зависят только от даты.
 * Все три разные.
 */
export function dailyChallenges(day: string): Challenge[] {
  const pool = [...CHALLENGES];
  let seed = hashDay(day);
  const picked: Challenge[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const idx = seed % pool.length;
    picked.push(pool.splice(idx, 1)[0]!);
  }
  return picked;
}

export function evaluateChallenge(c: Challenge, day: string, plans: readonly Plan[]): boolean {
  return c.check({ day, plans });
}

export { CHALLENGES };
