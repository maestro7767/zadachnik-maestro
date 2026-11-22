import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport, mergeImport } from "../src/data/transfer.ts";
import { emptyUserData, type UserData } from "../src/data/model.ts";

const PLAN = { id: "a1", cat: "study" as const, text: "Эссе", date: "2026-11-16", time: "18:00", done: false };

function userWith(over: Partial<UserData>): UserData {
  return { ...emptyUserData(), ...over };
}

test("экспорт и импорт в пустой аккаунт возвращают те же планы", () => {
  const source = userWith({ plans: [PLAN], notes: { study: "конспект", sport: "" } });
  const text = buildExport("ivan", source, "2026-11-16T10:00:00.000Z");
  const { result, user } = mergeImport(text, emptyUserData());
  assert.equal(result.ok, true);
  assert.deepEqual(user.plans, [PLAN]);
  assert.equal(user.notes.study, "конспект");
});

test("планы с известными id не дублируются", () => {
  const text = buildExport("ivan", userWith({ plans: [PLAN] }), "2026-11-16T10:00:00.000Z");
  const { result, user } = mergeImport(text, userWith({ plans: [PLAN] }));
  assert.equal(result.ok && result.added, 0);
  assert.equal(result.ok && result.skipped, 1);
  assert.equal(user.plans.length, 1);
});

test("локальный план не перезаписывается версией из файла", () => {
  const fileVersion = { ...PLAN, text: "другой текст", done: true };
  const text = buildExport("ivan", userWith({ plans: [fileVersion] }), "2026-11-16T10:00:00.000Z");
  const { user } = mergeImport(text, userWith({ plans: [PLAN] }));
  assert.equal(user.plans[0]?.text, "Эссе");
  assert.equal(user.plans[0]?.done, false);
});

test("заметка из файла заполняет только пустую локальную", () => {
  const text = buildExport("ivan", userWith({ notes: { study: "из файла", sport: "из файла" } }), "t");
  const { user, result } = mergeImport(text, userWith({ notes: { study: "локально", sport: "" } }));
  assert.equal(user.notes.study, "локально");
  assert.equal(user.notes.sport, "из файла");
  assert.equal(result.ok && result.notesFilled, true);
});

test("профиль в экспорт не попадает", () => {
  const text = buildExport("ivan", userWith({
    profile: { name: "Иван", bio: "", showStats: true, accent: "#fff", theme: "dark", notify: true, goal: 2, workStart: "09:00", workEnd: "18:00", avatar: "data:image/png;base64,AAA" },
  }), "t");
  assert.equal(text.includes("avatar"), false);
  assert.equal(text.includes("Иван"), false);
});

test("не JSON отклоняется с понятной ошибкой", () => {
  const { result } = mergeImport("это не json", emptyUserData());
  assert.equal(result.ok, false);
});

test("чужой JSON без метки формата отклоняется", () => {
  const { result } = mergeImport(JSON.stringify({ hello: 1 }), emptyUserData());
  assert.equal(result.ok, false);
});

test("файл из более новой версии отклоняется", () => {
  const text = JSON.stringify({ format: "maestro-export", version: 99, data: { plans: [] } });
  const { result } = mergeImport(text, emptyUserData());
  assert.equal(result.ok, false);
});

test("испорченные планы внутри файла пропускаются", () => {
  const text = JSON.stringify({
    format: "maestro-export", version: 1,
    data: { notes: { study: "", sport: "" }, plans: [PLAN, { id: 7, text: "плохой" }] },
  });
  const { result, user } = mergeImport(text, emptyUserData());
  assert.equal(result.ok && result.added, 1);
  assert.equal(user.plans.length, 1);
});
