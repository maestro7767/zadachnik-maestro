import { test } from "node:test";
import assert from "node:assert/strict";
import { diffEntities, flattenUserData, EPOCH } from "../src/sync/diff.ts";
import { emptyUserData, type UserData } from "../src/data/model.ts";
import { emptyStudy } from "../src/study/model.ts";

const T1 = "2026-11-23T10:00:00.000Z";
const T2 = "2026-11-23T11:00:00.000Z";

const plan = (id: string, updatedAt?: string) => ({
  id,
  cat: "study" as const,
  text: `План ${id}`,
  date: "2026-11-23",
  time: "",
  done: false,
  ...(updatedAt ? { updatedAt } : {}),
});

test("flatten раскладывает данные на сущности всех коллекций", () => {
  const data: UserData = {
    ...emptyUserData(),
    plans: [plan("p1", T1)],
    habits: [{ id: "h1", name: "Вода", doneDays: [], updatedAt: T1 }],
    study: { ...emptyStudy(), institution: "school", updatedAt: T1, subjects: [{ id: "s1", name: "Математика", failedAttempts: 0, updatedAt: T1 }] },
    profile: { name: "Тим", bio: "", showStats: true, accent: "#fff", theme: "dark", notify: true, goal: 2, workStart: "09:00", workEnd: "18:00", updatedAt: T1 },
  };
  data.notes.updatedAt = T1;
  const flat = flattenUserData(data);
  const colls = flat.map((e) => `${e.coll}:${e.id}`).sort();
  assert.deepEqual(colls, ["habits:h1", "notes:main", "plans:p1", "profile:main", "study_meta:main", "subjects:s1"].sort());
});

test("flatten: у сущностей без updatedAt метка EPOCH", () => {
  const flat = flattenUserData({ ...emptyUserData(), plans: [plan("p1")] });
  assert.equal(flat.find((e) => e.coll === "plans")?.updatedAt, EPOCH);
});

test("diff: новая сущность — изменение; одинаковые снимки — пусто", () => {
  const before = flattenUserData(emptyUserData());
  const after = flattenUserData({ ...emptyUserData(), plans: [plan("p1", T1)] });
  const changes = diffEntities(before, after, T2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.coll, "plans");
  assert.deepEqual(diffEntities(after, after, T2), []);
});

test("diff: изменённый updatedAt — в выдаче; исчезнувшая сущность — tombstone", () => {
  const v1 = flattenUserData({ ...emptyUserData(), plans: [plan("p1", T1), plan("p2", T1)] });
  const v2 = flattenUserData({ ...emptyUserData(), plans: [plan("p1", T2)] });
  const changes = diffEntities(v1, v2, T2);
  assert.equal(changes.length, 2);
  const updated = changes.find((c) => c.id === "p1");
  const deleted = changes.find((c) => c.id === "p2");
  assert.equal(updated?.updatedAt, T2);
  assert.equal(deleted?.deletedAt, T2);
  assert.equal(deleted?.payload, null);
});

test("diff: сущность, помеченная deletedAt, едет как изменение, а не tombstone", () => {
  const v1 = flattenUserData({ ...emptyUserData(), plans: [plan("p1", T1)] });
  const v2 = flattenUserData({ ...emptyUserData(), plans: [{ ...plan("p1", T2), deletedAt: T2 }] });
  const changes = diffEntities(v1, v2, T2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.deletedAt, T2);
  assert.notEqual(changes[0]?.payload, null);
});
