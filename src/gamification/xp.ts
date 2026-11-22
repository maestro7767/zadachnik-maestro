import type { Plan } from "../core/types.ts";

/** Опыт за выполненный план и бонус за план с указанным временем. */
export const XP_PER_PLAN = 10;
export const XP_TIMED_BONUS = 5;

export function xpForPlan(p: Plan): number {
  return XP_PER_PLAN + (p.time !== "" ? XP_TIMED_BONUS : 0);
}

/** Суммарный опыт, который нужен, чтобы достичь уровня (уровень 1 — с нуля). */
export function thresholdFor(level: number): number {
  return level <= 1 ? 0 : (50 * (level - 1) * level) / 2;
}

/** Текущий уровень по суммарному опыту. Пороги растут: 50, 150, 300, 500 и далее. */
export function levelFromXp(xp: number): number {
  let level = 1;
  while (thresholdFor(level + 1) <= xp) level++;
  return level;
}

export interface LevelProgress {
  readonly level: number;
  /** Сколько опыта осталось до следующего уровня. */
  readonly left: number;
  /** Процент прохождения текущего уровня (0–100). */
  readonly percent: number;
}

export function progressToNext(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const start = thresholdFor(level);
  const next = thresholdFor(level + 1);
  return {
    level,
    left: next - xp,
    percent: Math.round(((xp - start) / (next - start)) * 100),
  };
}
