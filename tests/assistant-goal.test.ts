import { test } from "node:test";
import assert from "node:assert/strict";
import { decomposeLocally, loadByDate } from "../src/assistant/decompose.ts";
import { unfinishedPlans, shouldOfferCarryover, movedPlans } from "../src/assistant/carryover.ts";

test("decomposeLocally: шаги внутри диапазона, от 2 до 7, по возрастанию", () => {
  const steps = decomposeLocally("Подготовиться к экзамену", "2026-11-23", "2026-12-13", {});
  assert.ok(steps.length >= 2 && steps.length <= 7);
  for (const s of steps) {
    assert.ok(s.date >= "2026-11-23" && s.date <= "2026-12-13");
    assert.ok(s.text.includes("Подготовиться к экзамену"));
  }
  const dates = steps.map((s) => s.date);
  assert.deepEqual(dates, [...dates].sort());
});

test("decomposeLocally избегает перегруженных дней", () => {
  const load = { "2026-11-24": 5, "2026-11-25": 5, "2026-11-26": 5, "2026-11-27": 5, "2026-11-28": 5, "2026-11-29": 5 };
  const steps = decomposeLocally("Цель", "2026-11-23", "2026-12-05", load);
  assert.ok(steps.every((s) => (load as Record<string, number>)[s.date] === undefined));
});

test("decomposeLocally: все дни забиты — всё равно предлагает", () => {
  const load: Record<string, number> = {};
  for (let d = 23; d <= 30; d++) load[`2026-11-${d}`] = 9;
  const steps = decomposeLocally("Цель", "2026-11-23", "2026-11-30", load);
  assert.ok(steps.length >= 2);
});

test("decomposeLocally: пустой диапазон — пустой результат", () => {
  assert.deepEqual(decomposeLocally("Цель", "2026-11-30", "2026-11-23", {}), []);
});

test("loadByDate считает только живые невыполненные планы", () => {
  const load = loadByDate([
    { date: "2026-11-23", done: false },
    { date: "2026-11-23", done: false },
    { date: "2026-11-23", done: true },
    { date: "2026-11-24", done: false, deletedAt: "2026-11-20T00:00:00Z" },
  ]);
  assert.deepEqual(load, { "2026-11-23": 2 });
});

const plan = (id: string, date: string, done = false) => ({
  id, cat: "life" as const, text: `Дело ${id}`, date, time: "", done, deletedAt: null,
});

test("unfinishedPlans: просроченные и сегодняшние невыполненные, по порядку", () => {
  const plans = [plan("a", "2026-11-25"), plan("b", "2026-11-23"), plan("c", "2026-11-20"), plan("d", "2026-11-21", true)];
  const due = unfinishedPlans(plans, "2026-11-23");
  assert.deepEqual(due.map((p) => p.id), ["c", "b"]); // d выполнен
});

test("shouldOfferCarryover: вечером, есть невыполненное, не гасили сегодня", () => {
  const plans = [plan("a", "2026-11-23")];
  assert.equal(shouldOfferCarryover("19:00", "18:00", "2026-11-23", plans, null), true);
  assert.equal(shouldOfferCarryover("12:00", "18:00", "2026-11-23", plans, null), false); // ещё день
  assert.equal(shouldOfferCarryover("19:00", "18:00", "2026-11-23", plans, "2026-11-23"), false); // уже закрыли
  assert.equal(shouldOfferCarryover("19:00", "18:00", "2026-11-23", [], null), false); // нечего переносить
});

test("movedPlans переносит только выбранные и штампует updatedAt", () => {
  const plans = [plan("a", "2026-11-20"), plan("b", "2026-11-21")];
  const moved = movedPlans(plans, ["a"], "2026-11-24", "2026-11-23T18:00:00Z");
  assert.equal(moved[0]!.date, "2026-11-24");
  assert.equal(moved[0]!.updatedAt, "2026-11-23T18:00:00Z");
  assert.equal(moved[1]!.date, "2026-11-21");
  assert.equal(plans[0]!.date, "2026-11-20"); // исходник не тронут
});
