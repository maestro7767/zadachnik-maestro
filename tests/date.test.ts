import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, monthGrid, weekOf, ymd, parseYmd, mondayIndex } from "../src/core/date.ts";

test("parseYmd и ymd обратимы", () => {
  assert.equal(ymd(parseYmd("2026-11-16")), "2026-11-16");
});

test("addDays переходит через границы месяца и года", () => {
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("неделя начинается с понедельника", () => {
  const week = weekOf("2026-11-18"); // среда
  assert.equal(week[0], "2026-11-16");
  assert.equal(week[6], "2026-11-22");
  assert.equal(week.length, 7);
});

test("неделя для воскресенья тоже начинается с понедельника", () => {
  assert.equal(weekOf("2026-11-22")[0], "2026-11-16");
});

test("индекс понедельника равен 0, воскресенья 6", () => {
  assert.equal(mondayIndex(parseYmd("2026-11-16")), 0);
  assert.equal(mondayIndex(parseYmd("2026-11-22")), 6);
});

test("сетка ноября 2026 начинается с пустых ячеек (1 ноября — воскресенье)", () => {
  const grid = monthGrid(2026, 10);
  assert.equal(grid.slice(0, 6).every((c) => c === null), true);
  assert.equal(grid[6], "2026-11-01");
  assert.equal(grid.length, 6 + 30);
});

test("сетка февраля 2026 содержит 28 дат", () => {
  const grid = monthGrid(2026, 1);
  assert.equal(grid.filter((c) => c !== null).length, 28);
});
