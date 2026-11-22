import { test } from "node:test";
import assert from "node:assert/strict";
import { completionPercent, categoryPercent, streak, weeklyDoneCounts } from "../src/core/stats.ts";
import type { Plan } from "../src/core/types.ts";

const plan = (over: Partial<Plan>): Plan => ({
  id: "x", cat: "life", text: "t", date: "2026-11-16", time: "", done: false, ...over,
});

test("процент выполнения пустого списка равен 0", () => {
  assert.equal(completionPercent([]), 0);
});

test("процент выполнения округляется", () => {
  const plans = [plan({ done: true }), plan({}), plan({})];
  assert.equal(completionPercent(plans), 33);
});

test("процент по категории не учитывает другие отделы", () => {
  const plans = [plan({ cat: "study", done: true }), plan({ cat: "sport" })];
  assert.equal(categoryPercent(plans, "study"), 100);
  assert.equal(categoryPercent(plans, "sport"), 0);
});

test("серия считает подряд идущие дни с выполненными планами", () => {
  const plans = [
    plan({ date: "2026-11-16", done: true }),
    plan({ date: "2026-11-15", done: true }),
    plan({ date: "2026-11-14", done: true }),
    plan({ date: "2026-11-12", done: true }),
  ];
  assert.equal(streak(plans, "2026-11-16"), 3);
});

test("серия не обнуляется, если сегодня ещё ничего не выполнено", () => {
  const plans = [plan({ date: "2026-11-15", done: true }), plan({ date: "2026-11-14", done: true })];
  assert.equal(streak(plans, "2026-11-16"), 2);
});

test("серия прерывается пропущенным днём", () => {
  const plans = [plan({ date: "2026-11-16", done: true }), plan({ date: "2026-11-14", done: true })];
  assert.equal(streak(plans, "2026-11-16"), 1);
});

test("невыполненные планы не входят в серию", () => {
  const plans = [plan({ date: "2026-11-16", done: false })];
  assert.equal(streak(plans, "2026-11-16"), 0);
});

test("недельная статистика считает выполненные по дням Пн–Вс", () => {
  const plans = [
    plan({ date: "2026-11-16", done: true }),
    plan({ date: "2026-11-16", done: true }),
    plan({ date: "2026-11-22", done: true }),
    plan({ date: "2026-11-22", done: false }),
    plan({ date: "2026-11-10", done: true }),
  ];
  assert.deepEqual(weeklyDoneCounts(plans, "2026-11-18"), [2, 0, 0, 0, 0, 0, 1]);
});
