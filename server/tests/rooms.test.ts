import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/app.ts";

function makeApp() {
  return buildApp(openDb());
}

async function register(app: ReturnType<typeof buildApp>, email: string, name = "Юзер"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: "s3cret-pass", name } });
  assert.equal(res.statusCode, 201);
  return res.json().accessToken as string;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function createRoom(app: ReturnType<typeof buildApp>, t: string, name = "Семья"): Promise<{ id: string; inviteCode: string }> {
  const res = await app.inject({ method: "POST", url: "/rooms", headers: auth(t), payload: { name } });
  assert.equal(res.statusCode, 201);
  return res.json() as { id: string; inviteCode: string };
}

test("создание комнаты: код приглашения, роль owner, валидация имени", async () => {
  const app = makeApp();
  const t = await register(app, "owner@b.c");
  const room = await createRoom(app, t);
  assert.equal(room.inviteCode.length, 6);

  assert.equal((await app.inject({ method: "POST", url: "/rooms", headers: auth(t), payload: { name: "я" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/rooms", payload: { name: "Без токена" } })).statusCode, 401);

  const list = await app.inject({ method: "GET", url: "/rooms", headers: auth(t) });
  const rooms = list.json().rooms as { name: string; role: string; members: number; weeklyGoal: number }[];
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0]?.role, "owner");
  assert.equal(rooms[0]?.members, 1);
  assert.equal(rooms[0]?.weeklyGoal, 10);
});

test("вход по коду: успех, неизвестный код 404, повтор 409", async () => {
  const app = makeApp();
  const t1 = await register(app, "o@b.c");
  const t2 = await register(app, "m@b.c", "Друг");
  const room = await createRoom(app, t1);

  const bad = await app.inject({ method: "POST", url: "/rooms/join", headers: auth(t2), payload: { code: "ZZZZZZ" } });
  assert.equal(bad.statusCode, 404);
  assert.equal(bad.json().error, "invite_not_found");

  const ok = await app.inject({ method: "POST", url: "/rooms/join", headers: auth(t2), payload: { code: room.inviteCode.toLowerCase() } });
  assert.equal(ok.statusCode, 201);

  const again = await app.inject({ method: "POST", url: "/rooms/join", headers: auth(t2), payload: { code: room.inviteCode } });
  assert.equal(again.statusCode, 409);

  // Деталь комнаты видна участникам: оба имени, код приглашения.
  const detail = await app.inject({ method: "GET", url: `/rooms/${room.id}`, headers: auth(t2) });
  assert.equal(detail.statusCode, 200);
  const d = detail.json();
  assert.equal(d.myRole, "member");
  assert.deepEqual(d.members.map((m: { role: string }) => m.role).sort(), ["member", "owner"]);
});

test("чужак: деталь 404, задачи 403", async () => {
  const app = makeApp();
  const t1 = await register(app, "o@b.c");
  const t2 = await register(app, "x@b.c");
  const room = await createRoom(app, t1);

  assert.equal((await app.inject({ method: "GET", url: `/rooms/${room.id}`, headers: auth(t2) })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/rooms/${room.id}/tasks`, headers: auth(t2) })).statusCode, 403);
});

test("задачи: добавление, переключение участником, weekDone растёт", async () => {
  const app = makeApp();
  const t1 = await register(app, "o@b.c");
  const t2 = await register(app, "m@b.c");
  const room = await createRoom(app, t1);
  await app.inject({ method: "POST", url: "/rooms/join", headers: auth(t2), payload: { code: room.inviteCode } });

  const add = await app.inject({
    method: "POST", url: `/rooms/${room.id}/tasks`, headers: auth(t2),
    payload: { text: "Купить молоко", date: "2026-11-27" },
  });
  assert.equal(add.statusCode, 201);
  const task = add.json() as { id: string; doneAt: string | null };
  assert.equal(task.doneAt, null);

  // Валидация текста и даты.
  assert.equal((await app.inject({ method: "POST", url: `/rooms/${room.id}/tasks`, headers: auth(t1), payload: { text: "  " } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: `/rooms/${room.id}/tasks`, headers: auth(t1), payload: { text: "х", date: "27.11" } })).statusCode, 400);

  const toggled = await app.inject({ method: "POST", url: `/rooms/${room.id}/tasks/${task.id}/toggle`, headers: auth(t1) });
  assert.equal(toggled.statusCode, 200);
  assert.ok(toggled.json().doneAt);

  // Повторный toggle снимает отметку.
  const back = await app.inject({ method: "POST", url: `/rooms/${room.id}/tasks/${task.id}/toggle`, headers: auth(t1) });
  assert.equal(back.json().doneAt, null);

  // weekDone считает только выполненные на этой неделе: сейчас 0.
  const list = await app.inject({ method: "GET", url: "/rooms", headers: auth(t1) });
  assert.equal(list.json().rooms[0].weekDone, 0);
  // Выполняем снова — 1.
  await app.inject({ method: "POST", url: `/rooms/${room.id}/tasks/${task.id}/toggle`, headers: auth(t1) });
  const list2 = await app.inject({ method: "GET", url: "/rooms", headers: auth(t1) });
  assert.equal(list2.json().rooms[0].weekDone, 1);
});

test("удаление задачи: автор или владелец, чужую нельзя", async () => {
  const app = makeApp();
  const t1 = await register(app, "o@b.c");
  const t2 = await register(app, "m@b.c");
  const room = await createRoom(app, t1);
  await app.inject({ method: "POST", url: "/rooms/join", headers: auth(t2), payload: { code: room.inviteCode } });

  const byOwner = (await app.inject({ method: "POST", url: `/rooms/${room.id}/tasks`, headers: auth(t1), payload: { text: "Задача владельца" } })).json() as { id: string };

  // Участник не может удалить чужую задачу.
  const deny = await app.inject({ method: "DELETE", url: `/rooms/${room.id}/tasks/${byOwner.id}`, headers: auth(t2) });
  assert.equal(deny.statusCode, 403);
  // Несуществующая задача — 404.
  assert.equal((await app.inject({ method: "DELETE", url: `/rooms/${room.id}/tasks/nope`, headers: auth(t1) })).statusCode, 404);
  // Владелец может.
  assert.equal((await app.inject({ method: "DELETE", url: `/rooms/${room.id}/tasks/${byOwner.id}`, headers: auth(t1) })).statusCode, 200);
});

test("выход и удаление: owner не может выйти, удалять комнату — только owner", async () => {
  const app = makeApp();
  const t1 = await register(app, "o@b.c");
  const t2 = await register(app, "m@b.c");
  const room = await createRoom(app, t1);
  await app.inject({ method: "POST", url: "/rooms/join", headers: auth(t2), payload: { code: room.inviteCode } });

  const ownerLeave = await app.inject({ method: "POST", url: `/rooms/${room.id}/leave`, headers: auth(t1) });
  assert.equal(ownerLeave.statusCode, 400);
  assert.equal(ownerLeave.json().error, "owner_cant_leave");

  assert.equal((await app.inject({ method: "POST", url: `/rooms/${room.id}/leave`, headers: auth(t2) })).statusCode, 200);
  // После выхода комнаты нет в списке.
  const list = await app.inject({ method: "GET", url: "/rooms", headers: auth(t2) });
  assert.equal(list.json().rooms.length, 0);
  // Повторный выход — 404.
  assert.equal((await app.inject({ method: "POST", url: `/rooms/${room.id}/leave`, headers: auth(t2) })).statusCode, 404);

  // Удалить комнату участник не может (он уже вышел, но проверим право само по себе через вторую комнату).
  assert.equal((await app.inject({ method: "DELETE", url: `/rooms/${room.id}`, headers: auth(t2) })).statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: `/rooms/${room.id}`, headers: auth(t1) })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/rooms/${room.id}`, headers: auth(t1) })).statusCode, 404);
});

test("цель недели: меняет только владелец, диапазон 1..100", async () => {
  const app = makeApp();
  const t1 = await register(app, "o@b.c");
  const t2 = await register(app, "m@b.c");
  const room = await createRoom(app, t1);
  await app.inject({ method: "POST", url: "/rooms/join", headers: auth(t2), payload: { code: room.inviteCode } });

  assert.equal((await app.inject({ method: "PATCH", url: `/rooms/${room.id}`, headers: auth(t2), payload: { weeklyGoal: 20 } })).statusCode, 403);
  assert.equal((await app.inject({ method: "PATCH", url: `/rooms/${room.id}`, headers: auth(t1), payload: { weeklyGoal: 0 } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: `/rooms/${room.id}`, headers: auth(t1), payload: { weeklyGoal: 101 } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PATCH", url: `/rooms/${room.id}`, headers: auth(t1), payload: { weeklyGoal: 25 } })).statusCode, 200);

  const detail = await app.inject({ method: "GET", url: `/rooms/${room.id}`, headers: auth(t1) });
  assert.equal(detail.json().weeklyGoal, 25);
});
