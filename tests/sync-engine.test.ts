import { test } from "node:test";
import assert from "node:assert/strict";
import { SyncEngine, type CloudSession } from "../src/sync/engine.ts";
import { ApiError, type SyncApi } from "../src/sync/api.ts";
import type { KeyValueStore } from "../src/data/storage.ts";
import { emptyUserData } from "../src/data/model.ts";

const T1 = "2026-11-23T10:00:00.000Z";
const NOW = "2026-11-23T12:00:00.000Z";

function memStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function session(expiresAt = Date.now() + 900_000): CloudSession {
  return { email: "a@b.c", accessToken: "acc", refreshToken: "ref", accessExpiresAt: expiresAt };
}

interface FakeApi extends SyncApi {
  pushed: unknown[][];
  pulled: (string | null)[];
  failNextPush?: "network" | "auth";
  failRefresh?: boolean;
  remoteChanges: unknown[];
}

function fakeApi(): FakeApi {
  const api: FakeApi = {
    pushed: [],
    pulled: [],
    remoteNow: NOW,
    remoteChanges: [],
    async register() {
      throw new Error("not used");
    },
    async login() {
      throw new Error("not used");
    },
    async refresh() {
      if (api.failRefresh) throw new ApiError(401, "invalid_token");
      return { accessToken: "acc2", refreshToken: "ref2", accessExpiresAt: Date.now() + 900_000 };
    },
    async logout() {},
    async getVapidKey() {
      throw new Error("not used");
    },
    async pushSubscribe() {},
    async pushUnsubscribe() {},
    async pushTest() {
      return { sent: 0, failed: 0, removed: 0 };
    },
    async aiDecompose() {
      throw new Error("not used");
    },
    async roomsList() {
      return { rooms: [] };
    },
    async roomCreate() {
      throw new Error("not used");
    },
    async roomJoin() {
      throw new Error("not used");
    },
    async roomGet() {
      throw new Error("not used");
    },
    async roomTasks() {
      return { tasks: [] };
    },
    async roomTaskAdd() {
      throw new Error("not used");
    },
    async roomTaskToggle() {
      throw new Error("not used");
    },
    async roomTaskDelete() {},
    async roomDelete() {},
    async roomLeave() {},
    async roomSetGoal() {},
    async pull(_token: string, since: string | null) {
      api.pulled.push(since);
      return { now: NOW, changes: api.remoteChanges as never };
    },
    async push(_token: string, changes: { coll: string; id: string }[]) {
      if (api.failNextPush === "network") {
        api.failNextPush = undefined;
        throw new TypeError("fetch failed");
      }
      if (api.failNextPush === "auth") {
        api.failNextPush = undefined;
        throw new ApiError(401, "invalid_token");
      }
      api.pushed.push(changes);
      return { now: NOW, results: changes.map((c) => ({ coll: c.coll, id: c.id, status: "applied" as const })) };
    },
  } as FakeApi & { remoteNow: string };
  return api;
}

/** Ручной таймер: запоминает колбэки, тест запускает их сам. */
function manualTimers() {
  const pending: (() => void)[] = [];
  return {
    pending,
    setTimeoutFn: (fn: () => void) => (pending.push(fn), pending.length),
    clearTimeoutFn: () => {},
    runNext() {
      const fn = pending.shift();
      if (fn) fn();
    },
  };
}

const sampleData = () => ({
  ...emptyUserData(),
  plans: [{ id: "p1", cat: "study" as const, text: "Домашка", date: "2026-11-23", time: "", done: false, updatedAt: T1 }],
});

test("локальная правка уходит на сервер, очередь очищается", async () => {
  const api = fakeApi();
  const timers = manualTimers();
  const engine = new SyncEngine({ api, store: memStore(), storageKey: "k", session: session(), nowIso: () => NOW, ...timers });
  engine.noteSnapshot(emptyUserData());
  engine.notifyLocal(sampleData());
  assert.equal(engine.pendingCount, 1); // только новый план: notes не менялись
  timers.runNext();
  await engine.flush();
  assert.equal(api.pushed.length, 1);
  assert.equal((api.pushed[0] as { id: string }[]).some((c) => c.id === "p1"), true);
  assert.equal(engine.pendingCount, 0);
});

test("outbox переживает перезапуск: новый движок дочитывает очередь", async () => {
  const store = memStore();
  const timers = manualTimers();
  const e1 = new SyncEngine({ api: fakeApi(), store, storageKey: "k", session: session(), nowIso: () => NOW, ...timers });
  e1.noteSnapshot(emptyUserData());
  e1.notifyLocal(sampleData());

  const api2 = fakeApi();
  const e2 = new SyncEngine({ api: api2, store, storageKey: "k", session: session(), nowIso: () => NOW, ...manualTimers() });
  assert.equal(e2.pendingCount, 1);
  await e2.flush();
  assert.equal(api2.pushed.length, 1);
  assert.equal(e2.pendingCount, 0);
});

test("pull отдаёт удалённые изменения в onRemote и двигает метку since", async () => {
  const api = fakeApi();
  api.remoteChanges = [{ coll: "plans", id: "r1", payload: { id: "r1" }, updatedAt: T1, deletedAt: null }];
  const remote: unknown[][] = [];
  const engine = new SyncEngine({
    api,
    store: memStore(),
    storageKey: "k",
    session: session(),
    onRemote: (ch) => remote.push([...ch]),
  });
  await engine.syncNow();
  assert.equal(remote.length, 1);
  assert.equal((remote[0]?.[0] as { id: string }).id, "r1");
  assert.deepEqual(api.pulled, [null]); // первая синхронизация — полная
  await engine.syncNow();
  assert.deepEqual(api.pulled, [null, NOW]); // дальше — инкрементально по since
});

test("401 на push: токен продлевается, запрос повторяется, сессия сохраняется", async () => {
  const api = fakeApi();
  api.failNextPush = "auth";
  const sessions: CloudSession[] = [];
  const engine = new SyncEngine({
    api,
    store: memStore(),
    storageKey: "k",
    session: session(),
    nowIso: () => NOW,
    onSession: (s) => sessions.push(s),
    ...manualTimers(),
  });
  engine.noteSnapshot(emptyUserData());
  engine.notifyLocal(sampleData());
  await engine.flush();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.accessToken, "acc2");
  assert.equal(api.pushed.length, 1);
  assert.equal(engine.getStatus(), "ok");
});

test("просроченный refresh: статус unauthorized, вызов onAuthLost", async () => {
  const api = fakeApi();
  api.failRefresh = true;
  let authLost = 0;
  const engine = new SyncEngine({
    api,
    store: memStore(),
    storageKey: "k",
    session: session(Date.now() - 1000), // access уже истёк — пойдём в refresh
    nowIso: () => NOW,
    onAuthLost: () => authLost++,
    ...manualTimers(),
  });
  engine.noteSnapshot(emptyUserData());
  engine.notifyLocal(sampleData());
  await engine.flush();
  assert.equal(authLost, 1);
  assert.equal(engine.getStatus(), "unauthorized");
});

test("сеть упала: статус offline, изменения остаются в очереди, планируется повтор", async () => {
  const api = fakeApi();
  api.failNextPush = "network";
  const timers = manualTimers();
  const engine = new SyncEngine({ api, store: memStore(), storageKey: "k", session: session(), nowIso: () => NOW, ...timers });
  engine.noteSnapshot(emptyUserData());
  engine.notifyLocal(sampleData());
  await engine.flush();
  assert.equal(engine.getStatus(), "offline");
  assert.equal(engine.pendingCount, 1);
  // Повторная попытка по таймеру проходит — сеть «ожила».
  timers.runNext();
  await engine.flush();
  assert.equal(engine.pendingCount, 0);
  assert.equal(engine.getStatus(), "ok");
});

test("uploadAll отправляет все сущности (миграция на пустой сервер)", async () => {
  const api = fakeApi();
  const engine = new SyncEngine({ api, store: memStore(), storageKey: "k", session: session(), nowIso: () => NOW });
  engine.uploadAll(sampleData());
  await engine.flush();
  const sent = api.pushed.flat() as { coll: string; id: string }[];
  assert.ok(sent.some((c) => c.coll === "plans" && c.id === "p1"));
  assert.ok(sent.some((c) => c.coll === "notes" && c.id === "main"));
});

test("noteSnapshot после применения удалённых изменений не порождает эхо", async () => {
  const api = fakeApi();
  api.remoteChanges = [{ coll: "plans", id: "r1", payload: { id: "r1", cat: "life", text: "x", date: "2026-11-23", time: "", done: false }, updatedAt: T1, deletedAt: null }];
  const engine = new SyncEngine({ api, store: memStore(), storageKey: "k", session: session(), nowIso: () => NOW });
  const data = emptyUserData();
  engine.noteSnapshot(data);
  await engine.syncNow();
  // UI применил изменения и сообщил снимок.
  const { applyRemoteChanges } = await import("../src/sync/merge.ts");
  applyRemoteChanges(data, api.remoteChanges as never);
  engine.noteSnapshot(data);
  engine.notifyLocal(data);
  assert.equal(engine.pendingCount, 0);
});
