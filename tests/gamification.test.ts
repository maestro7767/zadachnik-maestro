import { test } from "node:test";
import assert from "node:assert/strict";
import { xpForPlan, thresholdFor, levelFromXp, progressToNext, XP_PER_PLAN, XP_TIMED_BONUS } from "../src/gamification/xp.ts";
import { totalXp } from "../src/gamification/total.ts";
import { dailyChallenges, evaluateChallenge, CHALLENGES } from "../src/gamification/challenges.ts";
import { streakWithFreeze, rewardsEarned } from "../src/gamification/streaks.ts";
import type { Category, Plan } from "../src/core/types.ts";

const plan = (id: string, date: string, done: boolean, time = "", cat: Category = "life"): Plan => ({ id, cat, text: id, date, time, done });

// Понедельник, 16 ноября 2026 года.
const TODAY = "2026-11-16";

test("опыт за план: без времени 10, со временем 15", () => {
  assert.equal(xpForPlan(plan("a", TODAY, true)), XP_PER_PLAN);
  assert.equal(xpForPlan(plan("a", TODAY, true, "10:00")), XP_PER_PLAN + XP_TIMED_BONUS);
});

test("пороги уровней: 1 уровень с нуля, дальше 50, 150, 300", () => {
  assert.equal(thresholdFor(1), 0);
  assert.equal(thresholdFor(2), 50);
  assert.equal(thresholdFor(3), 150);
  assert.equal(thresholdFor(4), 300);
});

test("уровень по опыту", () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(49), 1);
  assert.equal(levelFromXp(50), 2);
  assert.equal(levelFromXp(150), 3);
});

test("прогресс до следующего уровня", () => {
  assert.deepEqual(progressToNext(0), { level: 1, left: 50, percent: 0 });
  assert.deepEqual(progressToNext(25), { level: 1, left: 25, percent: 50 });
});

test("испытания дня: три разных, детерминированы по дате", () => {
  const a = dailyChallenges(TODAY);
  const b = dailyChallenges(TODAY);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
  assert.equal(new Set(a.map((c) => c.id)).size, 3);
  assert.ok(a.every((c) => CHALLENGES.some((all) => all.id === c.id)));
});

test("испытание «выполни 2 плана» проверяется по планам дня", () => {
  const two = CHALLENGES.find((c) => c.id === "two")!;
  const plans = [plan("a", TODAY, true), plan("b", TODAY, true)];
  assert.equal(evaluateChallenge(two, TODAY, plans), true);
  assert.equal(evaluateChallenge(two, TODAY, [plans[0]!]), false);
});

test("суммарный опыт: планы до сегодня включительно, будущее не считается", () => {
  const plans = [
    plan("a", TODAY, true, "10:00"),
    plan("b", TODAY, false),
    plan("c", "2026-11-20", true),
  ];
  const xp = totalXp(plans, TODAY);
  assert.ok(xp >= XP_PER_PLAN + XP_TIMED_BONUS);
  assert.equal(totalXp([], TODAY), 0);
});

test("серия без пропусков", () => {
  const plans = [
    plan("a", TODAY, true),
    plan("b", "2026-11-15", true),
    plan("c", "2026-11-14", true),
  ];
  assert.equal(streakWithFreeze(plans, TODAY), 3);
});

test("серия: если сегодня ничего не выполнено, отсчёт от вчера", () => {
  const plans = [plan("b", "2026-11-15", true), plan("c", "2026-11-14", true)];
  assert.equal(streakWithFreeze(plans, TODAY), 2);
});

test("заморозка: один пропуск в неделю не обнуляет серию", () => {
  // Выполнены пт 13.11 и сб 14.11, вс 15.11 пропущено — серия жива, но пропуск не считается.
  const plans = [plan("a", "2026-11-13", true), plan("b", "2026-11-14", true)];
  assert.equal(streakWithFreeze(plans, TODAY), 2);
});

test("второй пропуск в той же неделе обрывает серию", () => {
  // Пропущены вс 15.11 (на него ушла заморозка недели) и сб 13.11 — серия обрывается.
  const plans = [plan("a", "2026-11-14", true), plan("b", "2026-11-12", true), plan("c", "2026-11-10", true)];
  assert.equal(streakWithFreeze(plans, TODAY), 1);
});

test("награды за серию", () => {
  assert.equal(rewardsEarned(0).length, 0);
  assert.equal(rewardsEarned(3).length, 1);
  assert.equal(rewardsEarned(7).length, 2);
  assert.equal(rewardsEarned(30).length, 4);
  assert.equal(rewardsEarned(7)[1]!.name, "Неделя без пропусков");
  assert.equal(rewardsEarned(14)[2]!.name, "Две недели");
});
