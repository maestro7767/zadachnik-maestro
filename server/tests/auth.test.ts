import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import { ACCESS_TTL_MS } from "../src/tokens.ts";
import { createRateLimiter } from "../src/ratelimit.ts";

const EMAIL = "ivan@example.com";
const PASSWORD = "s3cret-password";

function makeApp(opts: { nowMs?: () => number; rateLimit?: { limit: number; windowMs: number } } = {}) {
  const db = openDb();
  const app = buildApp(db, opts);
  return { db, app };
}

async function register(app: ReturnType<typeof buildApp>, email = EMAIL, password = PASSWORD) {
  return app.inject({ method: "POST", url: "/auth/register", payload: { email, password } });
}

async function login(app: ReturnType<typeof buildApp>, email = EMAIL, password = PASSWORD) {
  return app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
}

test("регистрация возвращает пару токенов, /me работает по access-токену", async () => {
  const { app } = makeApp();
  const res = await register(app);
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.ok(body.accessToken && body.refreshToken && body.accessExpiresAt > 0);

  const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${body.accessToken}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().email, EMAIL);
});

test("пароль хранится только хешем argon2id, не в открытом виде", async () => {
  const { db, app } = makeApp();
  await register(app);
  const row = db.prepare("SELECT pass_hash FROM users WHERE email = ?").get(EMAIL) as { pass_hash: string };
  assert.ok(row.pass_hash.startsWith("$argon2id$"));
  assert.ok(!row.pass_hash.includes(PASSWORD));
});

test("невалидный email и слабый пароль отклоняются", async () => {
  const { app } = makeApp();
  assert.equal((await register(app, "не-почта")).statusCode, 400);
  assert.equal((await register(app, "a@b.c", "short")).statusCode, 400);
});

test("повторная регистрация того же email — 409", async () => {
  const { app } = makeApp();
  await register(app);
  const res = await register(app);
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "email_taken");
});

test("email приводится к нижнему регистру: Ivan@ и ivan@ — один аккаунт", async () => {
  const { app } = makeApp();
  await register(app, "Ivan@Example.com");
  assert.equal((await login(app)).statusCode, 200);
  assert.equal((await register(app)).statusCode, 409);
});

test("вход: верный пароль пускает, неверный и несуществующий email дают одинаковый 401", async () => {
  const { app } = makeApp();
  await register(app);
  assert.equal((await login(app)).statusCode, 200);

  const wrongPass = await login(app, EMAIL, "wrong-password");
  const noUser = await login(app, "ghost@example.com", PASSWORD);
  assert.equal(wrongPass.statusCode, 401);
  assert.equal(noUser.statusCode, 401);
  assert.equal(wrongPass.json().error, noUser.json().error);
});

test("refresh ротирует токены: старый refresh сгорает", async () => {
  const { app } = makeApp();
  const { refreshToken } = (await register(app)).json();

  const rotated = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
  assert.equal(rotated.statusCode, 200);
  const fresh = rotated.json();
  assert.ok(fresh.accessToken && fresh.refreshToken);

  const again = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
  assert.equal(again.statusCode, 401);
});

test("logout отзывает refresh-токен", async () => {
  const { app } = makeApp();
  const { refreshToken } = (await register(app)).json();
  await app.inject({ method: "POST", url: "/auth/logout", payload: { refreshToken } });
  const res = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
  assert.equal(res.statusCode, 401);
});

test("просроченный access-токен не пускает", async () => {
  let now = 1_000_000_000_000;
  const { app } = makeApp({ nowMs: () => now });
  const { accessToken } = (await register(app)).json();

  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${accessToken}` } })).statusCode, 200);
  now += ACCESS_TTL_MS + 1000;
  assert.equal((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${accessToken}` } })).statusCode, 401);
});

test("запрос без токена — 401", async () => {
  const { app } = makeApp();
  assert.equal((await app.inject({ method: "GET", url: "/me" })).statusCode, 401);
});

test("rate limit: после лимита попыток — 429", async () => {
  const { app } = makeApp({ rateLimit: { limit: 3, windowMs: 60_000 } });
  await register(app);
  assert.equal((await login(app)).statusCode, 200);
  assert.equal((await login(app)).statusCode, 200);
  const res = await login(app);
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error, "rate_limited");
});

test("окно rate limit скользит по времени", () => {
  const limiter = createRateLimiter(2, 1000);
  assert.equal(limiter.hit("ip", 0), true);
  assert.equal(limiter.hit("ip", 500), true);
  assert.equal(limiter.hit("ip", 700), false);
  assert.equal(limiter.hit("ip", 1001), true);
});

test("регистрация с ником: name сохраняется, возвращается в login и /me", async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "nick@example.com", password: PASSWORD, name: "  Тим  " } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().name, "Тим");

  const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "nick@example.com", password: PASSWORD } });
  assert.equal(login.json().name, "Тим");

  const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${login.json().accessToken}` } });
  assert.equal(me.json().name, "Тим");
});

test("невалидный ник отклоняется, без ника регистрация работает", async () => {
  const { app } = makeApp();
  const bad = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "a1@example.com", password: PASSWORD, name: "я" } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "invalid_name");
  const ok = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "a2@example.com", password: PASSWORD } });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.json().name, "");
});

test("healthz отвечает без авторизации", async () => {
  const { app } = makeApp();
  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});
