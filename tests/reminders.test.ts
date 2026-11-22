import { test } from "node:test";
import assert from "node:assert/strict";
import { dueReminders, nowParts } from "../src/notifications/reminders.ts";
import type { Plan } from "../src/core/types.ts";

const NOW = { today: "2026-11-16", hm: "18:05" };
const plan = (over: Partial<Plan>): Plan => ({
  id: "x", cat: "study", text: "t", date: NOW.today, time: "18:00", done: false, ...over,
});

test("напоминание приходит, когда время плана наступило", () => {
  const r = dueReminders([plan({ id: "a", time: "18:00" })], NOW, []);
  assert.deepEqual(r.due.map((p) => p.id), ["a"]);
});

test("план на будущее время не напоминает", () => {
  const r = dueReminders([plan({ time: "19:00" })], NOW, []);
  assert.equal(r.due.length, 0);
});

test("выполненный план не напоминает", () => {
  const r = dueReminders([plan({ done: true })], NOW, []);
  assert.equal(r.due.length, 0);
});

test("план без времени не напоминает", () => {
  const r = dueReminders([plan({ time: "" })], NOW, []);
  assert.equal(r.due.length, 0);
});

test("план другого дня не напоминает", () => {
  const r = dueReminders([plan({ date: "2026-11-17" })], NOW, []);
  assert.equal(r.due.length, 0);
});

test("повторно о том же плане не напоминается", () => {
  const first = dueReminders([plan({ id: "a" })], NOW, []);
  const second = dueReminders([plan({ id: "a" })], NOW, first.notified);
  assert.equal(second.due.length, 0);
  assert.deepEqual(second.notified, ["a"]);
});

test("напоминания сортируются по времени", () => {
  const r = dueReminders(
    [plan({ id: "late", time: "17:30" }), plan({ id: "early", time: "09:00" })],
    NOW,
    [],
  );
  assert.deepEqual(r.due.map((p) => p.id), ["early", "late"]);
});

test("nowParts форматирует дату и время с ведущими нулями", () => {
  assert.deepEqual(nowParts(new Date(2026, 10, 6, 9, 5)), { today: "2026-11-06", hm: "09:05" });
});
