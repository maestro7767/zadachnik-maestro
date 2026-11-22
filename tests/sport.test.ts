import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidSet, setVolume, workoutVolume, exerciseProgress, DEFAULT_EXERCISES, MAX_WEIGHT_KG, MAX_REPS } from "../src/sport/workouts.ts";
import { remainingSec, isFinished, formatTime, skipRest } from "../src/sport/restTimer.ts";
import type { WorkoutEntry, WorkoutSet } from "../src/sport/workouts.ts";

const entry = (id: string, date: string, exerciseId: string, sets: WorkoutSet[]): WorkoutEntry => ({ id, date, exerciseId, sets });

test("подход корректен в пределах лимитов", () => {
  assert.equal(isValidSet({ weight: 60, reps: 8 }), true);
  assert.equal(isValidSet({ weight: 0, reps: 1 }), true);
  assert.equal(isValidSet({ weight: MAX_WEIGHT_KG + 1, reps: 8 }), false);
  assert.equal(isValidSet({ weight: 60, reps: 0 }), false);
  assert.equal(isValidSet({ weight: 60, reps: MAX_REPS + 1 }), false);
  assert.equal(isValidSet({ weight: 60, reps: 2.5 }), false);
});

test("объём подхода и тренировки", () => {
  assert.equal(setVolume({ weight: 60, reps: 8 }), 480);
  assert.equal(workoutVolume([{ weight: 60, reps: 8 }, { weight: 100, reps: 5 }]), 980);
});

test("прогресс по упражнению: максимальный вес и объём по дням, по дате", () => {
  const entries = [
    entry("b", "2026-11-14", "squat", [{ weight: 80, reps: 5 }]),
    entry("a", "2026-11-10", "squat", [{ weight: 70, reps: 5 }, { weight: 75, reps: 3 }]),
    entry("c", "2026-11-12", "bench", [{ weight: 50, reps: 10 }]),
  ];
  const prog = exerciseProgress(entries, "squat");
  assert.deepEqual(prog, [
    { date: "2026-11-10", maxWeight: 75, volume: 575 },
    { date: "2026-11-14", maxWeight: 80, volume: 400 },
  ]);
  assert.deepEqual(exerciseProgress(entries, "pullup"), []);
});

test("в стартовом списке есть базовые упражнения", () => {
  assert.ok(DEFAULT_EXERCISES.length >= 10);
  assert.ok(DEFAULT_EXERCISES.some((e) => e.id === "squat"));
});

test("оставшееся время округляется вверх и не уходит в минус", () => {
  const t = { startedAtMs: 1000, durationSec: 90 };
  assert.equal(remainingSec(t, 1000), 90);
  assert.equal(remainingSec(t, 1000 + 30_500), 60);
  assert.equal(remainingSec(t, 1000 + 90_000), 0);
  assert.equal(remainingSec(t, 1000 + 200_000), 0);
});

test("isFinished по нулю оставшегося времени", () => {
  const timer = { startedAtMs: 0, durationSec: 10 };
  assert.equal(isFinished(timer, 5000), false);
  assert.equal(isFinished(timer, 10_000), true);
});

test("формат времени мм:сс", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(1500), "25:00");
});

test("пропуск отдыха завершает таймер сразу, исходный не меняется", () => {
  const t = { startedAtMs: 1000, durationSec: 90 };
  const skipped = skipRest(t, 31_000);
  assert.equal(isFinished(skipped, 31_000), true);
  assert.equal(isFinished(t, 31_000), false);
});
