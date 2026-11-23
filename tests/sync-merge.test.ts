import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRemoteChange, applyRemoteChanges } from "../src/sync/merge.ts";
import { emptyUserData, type UserData } from "../src/data/model.ts";

const T1 = "2026-11-23T10:00:00.000Z";
const T2 = "2026-11-23T11:00:00.000Z";

const planPayload = (id: string, text: string) => ({ id, cat: "study", text, date: "2026-11-23", time: "", done: false });

test("удалённое изменение добавляет новую сущность", () => {
  const data = emptyUserData();
  const changed = applyRemoteChange(data, { coll: "plans", id: "p1", payload: planPayload("p1", "Купить молоко"), updatedAt: T1, deletedAt: null });
  assert.equal(changed, true);
  assert.equal(data.plans.length, 1);
  assert.equal(data.plans[0]!.text, "Купить молоко");
  assert.equal(data.plans[0]!.updatedAt, T1);
});

test("LWW: более свежее удалённое выигрывает, старое проигрывает", () => {
  const data = emptyUserData();
  applyRemoteChange(data, { coll: "plans", id: "p1", payload: planPayload("p1", "новое"), updatedAt: T2, deletedAt: null });
  const stale = applyRemoteChange(data, { coll: "plans", id: "p1", payload: planPayload("p1", "старое"), updatedAt: T1, deletedAt: null });
  assert.equal(stale, false);
  assert.equal(data.plans[0]!.text, "новое");
});

test("локальная версия новее — удалённое не затирает её", () => {
  const data = emptyUserData();
  data.plans.push({ ...planPayload("p1", "моё"), updatedAt: T2 } as UserData["plans"][number]);
  const changed = applyRemoteChange(data, { coll: "plans", id: "p1", payload: planPayload("p1", "чужое"), updatedAt: T1, deletedAt: null });
  assert.equal(changed, false);
  assert.equal(data.plans[0]!.text, "моё");
});

test("tombstone жёстко удаляет локальную сущность", () => {
  const data = emptyUserData();
  data.plans.push({ ...planPayload("p1", "удалить"), updatedAt: T1 } as UserData["plans"][number]);
  const changed = applyRemoteChange(data, { coll: "plans", id: "p1", payload: null, updatedAt: T2, deletedAt: T2 });
  assert.equal(changed, true);
  assert.equal(data.plans.length, 0);
  // Повторное применение tombstone — уже не изменение.
  assert.equal(applyRemoteChange(data, { coll: "plans", id: "p1", payload: null, updatedAt: T2, deletedAt: T2 }), false);
});

test("учебные коллекции создают study при необходимости", () => {
  const data = emptyUserData();
  applyRemoteChange(data, { coll: "subjects", id: "s1", payload: { id: "s1", name: "Физика", failedAttempts: 0 }, updatedAt: T1, deletedAt: null });
  assert.equal(data.study?.subjects.length, 1);
  assert.equal(data.study?.subjects[0]?.name, "Физика");
});

test("синглтоны: notes и profile обновляются только более свежими", () => {
  const data = emptyUserData();
  data.notes.updatedAt = T2;
  assert.equal(applyRemoteChange(data, { coll: "notes", id: "main", payload: { study: "старое", sport: "" }, updatedAt: T1, deletedAt: null }), false);
  assert.equal(applyRemoteChange(data, { coll: "profile", id: "main", payload: { name: "Тим", goal: 3 }, updatedAt: "2026-11-23T12:00:00.000Z", deletedAt: null }), true);
  assert.equal(data.profile?.name, "Тим");
});

test("study_meta применяет скалярные поля", () => {
  const data = emptyUserData();
  const changed = applyRemoteChange(data, {
    coll: "study_meta",
    id: "main",
    payload: { institution: "college", secondYear: true, attendance: 80 },
    updatedAt: T1,
    deletedAt: null,
  });
  assert.equal(changed, true);
  assert.equal(data.study?.institution, "college");
  assert.equal(data.study?.secondYear, true);
  assert.equal(data.study?.attendance, 80);
});

test("пачка изменений: возвращает true, если хоть одно применилось", () => {
  const data = emptyUserData();
  assert.equal(
    applyRemoteChanges(data, [
      { coll: "plans", id: "p1", payload: planPayload("p1", "a"), updatedAt: T1, deletedAt: null },
      { coll: "unknown_coll", id: "x", payload: {}, updatedAt: T1, deletedAt: null },
    ]),
    true,
  );
  assert.equal(applyRemoteChanges(data, [{ coll: "unknown_coll", id: "x", payload: {}, updatedAt: T1, deletedAt: null }]), false);
});
