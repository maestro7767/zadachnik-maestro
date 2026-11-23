import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import type { PushSubscriptionDto } from "../src/push.ts";
import { generateVAPIDKeys } from "web-push";

const VAPID = { subject: "mailto:test@example.com", ...generateVAPIDKeys() };
const SUB = {
  endpoint: "https://push.example.com/sub/abc123",
  keys: { p256dh: "BP256dhKey", auth: "AuthSecret" },
};

function makeApp(extra: Record<string, unknown> = {}) {
  const db = openDb();
  const app = buildApp(db, { vapid: VAPID, ...extra });
  return { db, app };
}

async function registerAndToken(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "a@b.c", password: "s3cret-pass" } });
  return res.json().accessToken as string;
}

test("vapid: без ключей — 503, с ключами — публичный ключ", async () => {
  const bare = buildApp(openDb());
  assert.equal((await bare.inject({ method: "GET", url: "/push/vapid" })).statusCode, 503);

  const { app } = makeApp();
  const res = await app.inject({ method: "GET", url: "/push/vapid" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().publicKey, VAPID.publicKey);
});

test("подписка требует авторизации", async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: "POST", url: "/push/subscribe", payload: { subscription: SUB } });
  assert.equal(res.statusCode, 401);
});

test("подписка сохраняется, повторная — обновляет, отписка удаляет", async () => {
  const { db, app } = makeApp();
  const token = await registerAndToken(app);
  const auth = { authorization: `Bearer ${token}` };

  const res = await app.inject({ method: "POST", url: "/push/subscribe", headers: auth, payload: { subscription: SUB } });
  assert.equal(res.statusCode, 201);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n, 1);

  // Повтор с тем же endpoint — не дубль, а обновление ключей.
  const again = await app.inject({
    method: "POST",
    url: "/push/subscribe",
    headers: auth,
    payload: { subscription: { endpoint: SUB.endpoint, keys: { p256dh: "NewKey", auth: "NewAuth" } } },
  });
  assert.equal(again.statusCode, 201);
  const row = db.prepare("SELECT p256dh FROM push_subscriptions").get() as { p256dh: string };
  assert.equal(row.p256dh, "NewKey");

  await app.inject({ method: "POST", url: "/push/unsubscribe", headers: auth, payload: { endpoint: SUB.endpoint } });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number }).n, 0);
});

test("мусорная подписка отклоняется", async () => {
  const { app } = makeApp();
  const token = await registerAndToken(app);
  const auth = { authorization: `Bearer ${token}` };
  assert.equal(
    (await app.inject({ method: "POST", url: "/push/subscribe", headers: auth, payload: { subscription: { endpoint: "http://x" } } })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: "/push/subscribe", headers: auth, payload: { subscription: { endpoint: SUB.endpoint } } })).statusCode,
    400,
  );
});

test("тестовый пуш уходит на все подписки, мёртвые вычищаются", async () => {
  const sent: PushSubscriptionDto[] = [];
  const pushSend = async (sub: PushSubscriptionDto) => {
    sent.push(sub);
    if (sub.endpoint.endsWith("dead")) {
      const err = new Error("gone") as Error & { statusCode: number };
      err.statusCode = 410;
      throw err;
    }
  };
  const { db, app } = makeApp({ pushSend });
  const token = await registerAndToken(app);
  const auth = { authorization: `Bearer ${token}` };

  await app.inject({ method: "POST", url: "/push/subscribe", headers: auth, payload: { subscription: SUB } });
  await app.inject({
    method: "POST",
    url: "/push/subscribe",
    headers: auth,
    payload: { subscription: { endpoint: "https://push.example.com/sub/dead", keys: SUB.keys } },
  });

  const res = await app.inject({ method: "POST", url: "/push/test", headers: auth });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { sent: 1, failed: 0, removed: 1 });
  assert.equal(sent.length, 2);
  // Мёртвая подписка вычищена, живая осталась.
  const rows = db.prepare("SELECT endpoint FROM push_subscriptions").all() as { endpoint: string }[];
  assert.deepEqual(rows.map((r) => r.endpoint), [SUB.endpoint]);
});

test("тестовый пуш без подписок — нули, без ключей — 503", async () => {
  const { app } = makeApp();
  const token = await registerAndToken(app);
  const res = await app.inject({ method: "POST", url: "/push/test", headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(res.json(), { sent: 0, failed: 0, removed: 0 });

  const bare = buildApp(openDb());
  const reg = await bare.inject({ method: "POST", url: "/auth/register", payload: { email: "x@y.z", password: "s3cret-pass" } });
  const bareRes = await bare.inject({
    method: "POST",
    url: "/push/test",
    headers: { authorization: `Bearer ${reg.json().accessToken}` },
  });
  assert.equal(bareRes.statusCode, 503);
});
