import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAppData, migrate, saveAppData, type KeyValueStore } from "../src/data/storage.ts";
import { SCHEMA_VERSION, emptyAppData } from "../src/data/model.ts";

/** Хранилище в памяти. Имитирует localStorage. */
function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const PLAN = { id: "a1", cat: "study", text: "Эссе", date: "2026-11-16", time: "18:00", done: false } as const;

test("пустое хранилище даёт пустые данные текущей версии", () => {
  const data = loadAppData(memoryStore(), "k");
  assert.deepEqual(data, emptyAppData());
});

test("сохранение и загрузка возвращают те же данные", () => {
  const store = memoryStore();
  const original = {
    version: SCHEMA_VERSION,
    users: { ivan: "hash" },
    data: { ivan: { notes: { study: "n", sport: "" }, plans: [PLAN] } },
    session: "ivan",
  };
  assert.equal(saveAppData(store, "k", original), true);
  assert.deepEqual(loadAppData(store, "k"), original);
});

test("испорченный JSON не ломает загрузку", () => {
  const store = memoryStore({ k: "{не json" });
  assert.deepEqual(loadAppData(store, "k"), emptyAppData());
});

test("данные без версии (старый формат) получают версию и недостающие поля", () => {
  const old = { users: { ivan: "h" }, data: { ivan: { plans: [PLAN] } }, session: "ivan" };
  const migrated = migrate(old);
  assert.equal(migrated.version, SCHEMA_VERSION);
  assert.deepEqual(migrated.data.ivan?.notes, { study: "", sport: "" });
  assert.equal(migrated.data.ivan?.plans.length, 1);
});

test("испорченные планы отбрасываются, остальные сохраняются", () => {
  const migrated = migrate({
    data: { ivan: { plans: [PLAN, { id: 5, text: "плохой" }, { ...PLAN, id: "b2", cat: "unknown" }] } },
  });
  assert.deepEqual(migrated.data.ivan?.plans.map((p) => p.id), ["a1"]);
});

test("сессия сбрасывается, если такого пользователя нет", () => {
  const migrated = migrate({ users: {}, data: {}, session: "ghost" });
  assert.equal(migrated.session, null);
});

test("сохранение возвращает false, если хранилище выбрасывает ошибку", () => {
  const failing: KeyValueStore = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  assert.equal(saveAppData(failing, "k", emptyAppData()), false);
});
