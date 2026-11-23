import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import { MAX_PUSH_CHANGES } from "../src/sync.ts";

const EMAIL = "sync@example.com";
const PASSWORD = "s3cret-password";

type App = ReturnType<typeof buildApp>;

async function makeUser(email = EMAIL) {
  const db = openDb();
  const app = buildApp(db);
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: PASSWORD } });
  const { accessToken } = res.json() as { accessToken: string };
  const auth = { authorization: `Bearer ${accessToken}` };
  return { db, app, auth };
}

function push(app: App, auth: Record<string, string>, changes: unknown[]) {
  return app.inject({ method: "POST", url: "/sync/push", headers: auth, payload: { changes } });
}

function pull(app: App, auth: Record<string, string>, since?: string) {
  const url = since ? `/sync/pull?since=${encodeURIComponent(since)}` : "/sync/pull";
  return app.inject({ method: "GET", url, headers: auth });
}

const plan = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  coll: "plans",
  id,
  payload: { id, cat: "study", text: `План ${id}`, date: "2026-11-23", time: "", done: false, ...extra },
  updatedAt,
  deletedAt: null,
});

test("push применяет изменения, pull отдаёт их обратно", async () => {
  const { app, auth } = await makeUser();
  const res = await push(app, auth, [plan("p1", "2026-11-23T10:00:00.000Z")]);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.now);
  assert.deepEqual(body.results, [{ coll: "plans", id: "p1", status: "applied" }]);

  const got = await pull(app, auth);
  assert.equal(got.statusCode, 200);
  const changes = got.json().changes;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].id, "p1");
  assert.equal(changes[0].payload.text, "План p1");
  assert.equal(changes[0].deletedAt, null);
});

test("pull?since= отдаёт только изменения после метки", async () => {
  const { app, auth } = await makeUser();
  await push(app, auth, [
    plan("old", "2026-11-20T10:00:00.000Z"),
    plan("new", "2026-11-23T10:00:00.000Z"),
  ]);
  const got = await pull(app, auth, "2026-11-22T00:00:00.000Z");
  const changes = got.json().changes;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].id, "new");
});

test("tombstone: удаление доезжает до pull с deletedAt", async () => {
  const { app, auth } = await makeUser();
  await push(app, auth, [plan("p1", "2026-11-23T10:00:00.000Z")]);
  await push(app, auth, [
    { coll: "plans", id: "p1", payload: null, updatedAt: "2026-11-23T11:00:00.000Z", deletedAt: "2026-11-23T11:00:00.000Z" },
  ]);
  const changes = (await pull(app, auth)).json().changes;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].deletedAt, "2026-11-23T11:00:00.000Z");
  assert.equal(changes[0].payload, null);
});

test("LWW: старая метка проигрывает, новая выигрывает; равная пропускается", async () => {
  const { app, auth } = await makeUser();
  await push(app, auth, [plan("p1", "2026-11-23T10:00:00.000Z", { text: "новый" })]);

  const stale = await push(app, auth, [plan("p1", "2026-11-23T09:00:00.000Z", { text: "старый" })]);
  assert.equal(stale.json().results[0].status, "skipped_stale");

  const same = await push(app, auth, [plan("p1", "2026-11-23T10:00:00.000Z", { text: "повтор" })]);
  assert.equal(same.json().results[0].status, "skipped_stale");

  const fresh = await push(app, auth, [plan("p1", "2026-11-23T12:00:00.000Z", { text: "свежий" })]);
  assert.equal(fresh.json().results[0].status, "applied");

  const changes = (await pull(app, auth)).json().changes;
  assert.equal(changes[0].payload.text, "свежий");
});

test("метки времени нормализуются к ISO UTC: сравнение не зависит от смещения", async () => {
  const { app, auth } = await makeUser();
  await push(app, auth, [plan("p1", "2026-11-23T10:00:00.000Z")]);
  // Тот же момент со смещением +03:00 — не должен перезаписать.
  const res = await push(app, auth, [plan("p1", "2026-11-23T13:00:00+03:00", { text: "тот же момент" })]);
  assert.equal(res.json().results[0].status, "skipped_stale");
});

test("данные пользователей изолированы друг от друга", async () => {
  const db = openDb();
  const app = buildApp(db);
  const reg = async (email: string) =>
    (await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: PASSWORD } })).json() as {
      accessToken: string;
    };
  const a = { authorization: `Bearer ${(await reg("a@example.com")).accessToken}` };
  const b = { authorization: `Bearer ${(await reg("b@example.com")).accessToken}` };

  await push(app, a, [plan("shared-id", "2026-11-23T10:00:00.000Z", { text: "от A" })]);
  assert.equal((await pull(app, b)).json().changes.length, 0);

  await push(app, b, [plan("shared-id", "2026-11-23T10:00:00.000Z", { text: "от B" })]);
  const changes = (await pull(app, a)).json().changes;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].payload.text, "от A");
});

test("pull и push требуют access-токен", async () => {
  const { app } = await makeUser();
  assert.equal((await app.inject({ method: "GET", url: "/sync/pull" })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/sync/push", payload: { changes: [] } })).statusCode, 401);
});

test("невалидный since — 400", async () => {
  const { app, auth } = await makeUser();
  const res = await pull(app, auth, "не-дата");
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_since");
});

test("невалидные изменения отклоняются поштучно, валидные применяются", async () => {
  const { app, auth } = await makeUser();
  const res = await push(app, auth, [
    plan("good", "2026-11-23T10:00:00.000Z"),
    { coll: "hacker", id: "x", payload: {}, updatedAt: "2026-11-23T10:00:00.000Z" },
    { coll: "plans", id: "", payload: {}, updatedAt: "2026-11-23T10:00:00.000Z" },
    { coll: "plans", id: "no-date", payload: {}, updatedAt: "куда" },
    { coll: "plans", id: "arr", payload: [1, 2], updatedAt: "2026-11-23T10:00:00.000Z" },
    "мусор",
  ]);
  assert.equal(res.statusCode, 200);
  const results = res.json().results;
  assert.deepEqual(
    results.map((r: { status: string }) => r.status),
    ["applied", "rejected", "rejected", "rejected", "rejected", "rejected"],
  );
  assert.equal(results[1].error, "unknown_collection");
  const changes = (await pull(app, auth)).json().changes;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].id, "good");
});

test("push без массива changes — 400, переполнение пачки — 400", async () => {
  const { app, auth } = await makeUser();
  assert.equal(
    (await app.inject({ method: "POST", url: "/sync/push", headers: auth, payload: { nope: 1 } })).statusCode,
    400,
  );
  const huge = Array.from({ length: MAX_PUSH_CHANGES + 1 }, (_, i) => plan(`p${i}`, "2026-11-23T10:00:00.000Z"));
  const res = await push(app, auth, huge);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "too_many_changes");
});

test("синглтоны notes/profile живут как коллекции с id main", async () => {
  const { app, auth } = await makeUser();
  await push(app, auth, [
    { coll: "notes", id: "main", payload: { study: "конспект", sport: "" }, updatedAt: "2026-11-23T10:00:00.000Z", deletedAt: null },
    { coll: "profile", id: "main", payload: { name: "Тим", goal: 4 }, updatedAt: "2026-11-23T10:00:00.000Z", deletedAt: null },
  ]);
  const changes = (await pull(app, auth)).json().changes;
  assert.equal(changes.length, 2);
  const notes = changes.find((c: { coll: string }) => c.coll === "notes");
  assert.equal(notes.payload.study, "конспект");
});
