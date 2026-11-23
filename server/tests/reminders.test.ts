import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { saveSubscription } from "../src/push.ts";
import type { PushSubscriptionDto } from "../src/push.ts";
import { findDueReminders, runReminderPass } from "../src/reminders.ts";

const USER = "user-1";
const SUB: PushSubscriptionDto = { endpoint: "https://push.example.com/s1", keys: { p256dh: "k", auth: "a" } };

function setup(tzOffset: number | null = -180) {
  const db = openDb();
  db.prepare("INSERT INTO users (id, email, pass_hash, name, created_at) VALUES (?, ?, ?, ?, ?)").run(
    USER,
    "a@b.c",
    "hash",
    "",
    new Date().toISOString(),
  );
  saveSubscription(db, USER, SUB, tzOffset);
  return db;
}

function addPlan(db: ReturnType<typeof openDb>, id: string, plan: Record<string, unknown>) {
  db.prepare(
    "INSERT INTO entities (user_id, coll, id, payload, updated_at, deleted_at) VALUES (?, 'plans', ?, ?, ?, NULL)",
  ).run(USER, id, JSON.stringify(plan), new Date().toISOString());
}

// 2026-11-23 12:00 UTC. Для МСК (offset -180) это 15:00 локально.
const NOW_UTC = Date.UTC(2026, 10, 23, 12, 0, 0);

test("план с наступившим временем сегодня — в списке напоминаний", () => {
  const db = setup();
  addPlan(db, "p1", { text: "Математика", date: "2026-11-23", time: "14:30", done: false });
  const due = findDueReminders(db, NOW_UTC);
  assert.deepEqual(due, [{ userId: USER, planId: "p1", text: "Математика", time: "14:30" }]);
});

test("выполненные, будущие и вчерашние планы не напоминаются", () => {
  const db = setup();
  addPlan(db, "done", { text: "Готово", date: "2026-11-23", time: "10:00", done: true });
  addPlan(db, "future", { text: "Позже", date: "2026-11-23", time: "18:00", done: false });
  addPlan(db, "yesterday", { text: "Вчера", date: "2026-11-22", time: "10:00", done: false });
  addPlan(db, "notime", { text: "Без времени", date: "2026-11-23", time: "", done: false });
  assert.equal(findDueReminders(db, NOW_UTC).length, 0);
});

test("часовой пояс решает: в UTC ещё утро, в МСК — день", () => {
  const msk = setup(-180);
  addPlan(msk, "p", { text: "Звонок", date: "2026-11-23", time: "15:00", done: false });
  assert.equal(findDueReminders(msk, NOW_UTC).length, 1);

  const utc = setup(0);
  addPlan(utc, "p", { text: "Звонок", date: "2026-11-23", time: "15:00", done: false });
  assert.equal(findDueReminders(utc, NOW_UTC).length, 0); // в UTC ещё 12:00

  const none = setup(null);
  addPlan(none, "p", { text: "Звонок", date: "2026-11-23", time: "15:00", done: false });
  assert.equal(findDueReminders(none, NOW_UTC).length, 0); // без зоны — UTC
});

test("runReminderPass шлёт пуш один раз и записывает факт", async () => {
  const db = setup();
  addPlan(db, "p1", { text: "Математика", date: "2026-11-23", time: "14:30", done: false });
  const sent: string[] = [];
  const send = async (_sub: PushSubscriptionDto, payload: string) => {
    sent.push(payload);
  };

  const first = await runReminderPass(db, send, NOW_UTC);
  assert.deepEqual(first, { plans: 1, sent: 1, failed: 0 });
  assert.ok((sent[0] ?? "").includes("Математика"));

  const second = await runReminderPass(db, send, NOW_UTC + 60_000);
  assert.deepEqual(second, { plans: 0, sent: 0, failed: 0 });
  assert.equal(sent.length, 1);
});

test("битый payload и tombstone не ломают проход", async () => {
  const db = setup();
  db.prepare("INSERT INTO entities (user_id, coll, id, payload, updated_at) VALUES (?, 'plans', 'bad', '{oops', ?)").run(
    USER,
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT INTO entities (user_id, coll, id, payload, updated_at, deleted_at) VALUES (?, 'plans', 'del', '{}', ?, ?)",
  ).run(USER, new Date().toISOString(), new Date().toISOString());
  const res = await runReminderPass(db, async () => {}, NOW_UTC);
  assert.deepEqual(res, { plans: 0, sent: 0, failed: 0 });
});
