import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleDay, habitStreak, isDoneOn } from "../src/habits/habits.ts";
import { starterHabits, STARTER_HABITS } from "../src/habits/starter.ts";

// Понедельник, 16 ноября 2026 года.
const TODAY = "2026-11-16";

test("toggleDay добавляет и убирает день, не меняя исходный список", () => {
  const days = ["2026-11-14"];
  const added = toggleDay(days, TODAY);
  assert.deepEqual(added, ["2026-11-14", TODAY]);
  assert.deepEqual(days, ["2026-11-14"]);
  assert.deepEqual(toggleDay(added, TODAY), ["2026-11-14"]);
});

test("toggleDay держит даты отсортированными", () => {
  assert.deepEqual(toggleDay(["2026-11-16"], "2026-11-10"), ["2026-11-10", "2026-11-16"]);
});

test("серия привычки и отсчёт от вчера", () => {
  const days = ["2026-11-14", "2026-11-15"];
  assert.equal(habitStreak(days, TODAY), 2);
  assert.equal(habitStreak([...days, TODAY], TODAY), 3);
});

test("заморозка: один пропуск в неделю сохраняет серию привычки", () => {
  const days = ["2026-11-13", "2026-11-14"];
  assert.equal(habitStreak(days, TODAY), 2);
});

test("isDoneOn проверяет отметку за день", () => {
  assert.equal(isDoneOn([TODAY], TODAY), true);
  assert.equal(isDoneOn([], TODAY), false);
});

test("стартовые привычки создаются с пустой историей", () => {
  const habits = starterHabits();
  assert.equal(habits.length, STARTER_HABITS.length);
  assert.ok(habits.every((h) => h.doneDays.length === 0));
  assert.equal(habits[0]!.id, "water");
});
