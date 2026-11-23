import { dailyChallenges, evaluateChallenge } from "./challenges.ts";
import { xpForPlan } from "./xp.ts";
import type { Plan } from "../core/types.ts";

/**
 * Суммарный опыт: за выполненные планы и за выполненные испытания дней до today включительно.
 * Всё считается из планов, поэтому отдельно хранить опыт не нужно.
 */
export function totalXp(plans: readonly Plan[], today: string): number {
  const live = plans.filter((p) => !p.deletedAt);
  let xp = live
    .filter((p) => p.done && p.date <= today)
    .reduce((sum, p) => sum + xpForPlan(p), 0);
  const days = new Set(live.filter((p) => p.date <= today).map((p) => p.date));
  for (const day of days) {
    for (const c of dailyChallenges(day)) {
      if (evaluateChallenge(c, day, live)) xp += c.xp;
    }
  }
  return xp;
}
