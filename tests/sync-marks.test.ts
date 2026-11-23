import { test } from "node:test";
import assert from "node:assert/strict";
import { completionPercent, streak, weeklyDoneCounts } from "../src/core/stats.ts";
import { totalXp } from "../src/gamification/total.ts";
import { streakWithFreeze } from "../src/gamification/streaks.ts";
import { dueReminders } from "../src/notifications/reminders.ts";
import { lessonsOn } from "../src/study/lessons.ts";
import { upcomingDeadlines } from "../src/study/deadlines.ts";
import { dueCards } from "../src/study/flashcards.ts";
import { exerciseProgress } from "../src/sport/workouts.ts";
import { migrate } from "../src/data/storage.ts";
import type { Category, Plan } from "../src/core/types.ts";

// Понедельник, 16 ноября 2026 года.
const TODAY = "2026-11-16";

const plan = (id: string, date: string, done: boolean, deletedAt: string | null = null, time = "", cat: Category = "life"): Plan =>
  ({ id, cat, text: id, date, time, done, updatedAt: "2026-11-16T12:00:00.000Z", deletedAt });

test("удалённые планы не считаются в проценте выполнения", () => {
  const plans = [plan("a", TODAY, true), plan("b", TODAY, false), plan("c", TODAY, false, "2026-11-16T13:00:00.000Z")];
  assert.equal(completionPercent(plans), 50);
});

test("удалённые планы не дают серию и опыт", () => {
  const plans = [plan("a", TODAY, true, "2026-11-16T13:00:00.000Z")];
  assert.equal(streak(plans, TODAY), 0);
  assert.equal(streakWithFreeze(plans, TODAY), 0);
  assert.equal(totalXp(plans, TODAY), 0);
});

test("удалённые планы не попадают в график недели и напоминания", () => {
  const plans = [plan("a", TODAY, true, "2026-11-16T13:00:00.000Z")];
  assert.deepEqual(weeklyDoneCounts(plans, TODAY), [0, 0, 0, 0, 0, 0, 0]);
  const { due } = dueReminders(
    [plan("b", TODAY, false, "2026-11-16T13:00:00.000Z", "10:00")],
    { today: TODAY, hm: "11:00" },
    [],
  );
  assert.equal(due.length, 0);
});

test("удалённые занятия, дедлайны и карточки скрываются", () => {
  const deleted = "2026-11-16T13:00:00.000Z";
  const lessons = [
    { id: "a", weekday: 1, start: "09:00", end: "10:30", subject: "Математика", deletedAt: deleted },
    { id: "b", weekday: 1, start: "11:00", end: "12:30", subject: "Физика", deletedAt: null },
  ];
  assert.deepEqual(lessonsOn(lessons, TODAY).map((l) => l.id), ["b"]);

  const deadlines = [
    { id: "a", title: "Эссе", due: "2026-11-20", deletedAt: deleted },
    { id: "b", title: "Лаба", due: "2026-11-21", deletedAt: null },
  ];
  assert.deepEqual(upcomingDeadlines(deadlines, TODAY, 14).map((d) => d.id), ["b"]);

  const cards = [
    { id: "a", front: "", back: "", box: 0, due: TODAY, deletedAt: deleted },
    { id: "b", front: "", back: "", box: 0, due: TODAY, deletedAt: null },
  ];
  assert.deepEqual(dueCards(cards, TODAY).map((c) => c.id), ["b"]);
});

test("удалённые тренировки не попадают в прогресс", () => {
  const entries = [
    { id: "a", date: TODAY, exerciseId: "squat", sets: [{ weight: 80, reps: 5 }], deletedAt: "2026-11-16T13:00:00.000Z" },
    { id: "b", date: TODAY, exerciseId: "squat", sets: [{ weight: 60, reps: 8 }], deletedAt: null },
  ];
  assert.deepEqual(exerciseProgress(entries, "squat"), [{ date: TODAY, maxWeight: 60, volume: 480 }]);
});

test("старые данные без меток загружаются как живые", () => {
  const old = {
    version: 1,
    users: { ivan: "h" },
    data: { ivan: { notes: { study: "", sport: "" }, plans: [{ id: "a", cat: "life", text: "Старое", date: TODAY, time: "", done: true }] } },
    session: "ivan",
  };
  const migrated = migrate(old);
  const p = migrated.data.ivan!.plans[0]!;
  assert.equal(p.deletedAt, undefined);
  assert.equal(p.updatedAt, undefined);
  assert.equal(completionPercent(migrated.data.ivan!.plans), 100);
  assert.equal(streak(migrated.data.ivan!.plans, TODAY), 1);
});
