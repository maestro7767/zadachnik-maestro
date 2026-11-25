import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryShare, weekdayProductivity, weeklyReport, weekdayIdx } from "../src/stats/analytics.ts";

const plan = (id: string, cat: "study" | "sport" | "life", date: string, done: boolean, deletedAt: string | null = null) => ({
  id, cat, text: id, date, time: "", done, deletedAt,
});

// 2026-11-25 — среда; неделя 23–29 ноября, прошлая 16–22.
test("categoryShare: считает по отделам в периоде, tombstones и чужие даты не попадают", () => {
  const plans = [
    plan("a", "study", "2026-11-23", true),
    plan("b", "study", "2026-11-24", false),
    plan("c", "sport", "2026-11-25", true),
    plan("d", "life", "2026-11-25", true, "2026-11-25T00:00:00Z"), // удалён
    plan("e", "sport", "2026-12-01", true), // вне периода
  ];
  const share = categoryShare(plans, "2026-11-23", "2026-11-29");
  assert.deepEqual(
    share.map((s) => [s.cat, s.total, s.done]),
    [["study", 2, 1], ["sport", 1, 1], ["life", 0, 0]],
  );
});

test("weekdayIdx: понедельник — 0, воскресенье — 6", () => {
  assert.equal(weekdayIdx("2026-11-23"), 0); // Пн
  assert.equal(weekdayIdx("2026-11-29"), 6); // Вс
});

test("weekdayProductivity: лучший день по выполненным, без выполненных — null", () => {
  const plans = [
    plan("a", "life", "2026-11-23", true), // Пн
    plan("b", "life", "2026-11-16", true), // Пн
    plan("c", "life", "2026-11-25", true), // Ср
  ];
  const r = weekdayProductivity(plans);
  assert.equal(r.counts[0], 2);
  assert.equal(r.counts[2], 1);
  assert.equal(r.best, 0); // понедельник
  assert.equal(weekdayProductivity([plan("x", "life", "2026-11-23", false)]).best, null);
});

test("weeklyReport: итоги недели, сравнение с прошлой, топ-отдел", () => {
  const plans = [
    plan("a", "study", "2026-11-23", true),
    plan("b", "study", "2026-11-24", true),
    plan("c", "sport", "2026-11-25", false),
    plan("d", "sport", "2026-11-17", true), // прошлая неделя
  ];
  const r = weeklyReport(plans, "2026-11-25");
  assert.equal(r.from, "2026-11-23");
  assert.equal(r.to, "2026-11-29");
  assert.equal(r.total, 3);
  assert.equal(r.done, 2);
  assert.equal(r.pct, 67);
  assert.equal(r.prevDone, 1);
  assert.equal(r.delta, 1);
  assert.equal(r.topCategory, "Учёба");
});

test("weeklyReport на пустой неделе: нули, без топ-отдела", () => {
  const r = weeklyReport([], "2026-11-25");
  assert.equal(r.total, 0);
  assert.equal(r.pct, 0);
  assert.equal(r.topCategory, null);
});
