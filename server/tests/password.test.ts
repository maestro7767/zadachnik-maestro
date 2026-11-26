import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/app.ts";

function makeApp() {
  return buildApp(openDb());
}

async function register(app: ReturnType<typeof buildApp>, email: string): Promise<{ access: string; refresh: string }> {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: "old-pass-123", name: "Юзер" } });
  assert.equal(res.statusCode, 201);
  return { access: res.json().accessToken as string, refresh: res.json().refreshToken as string };
}

test("смена пароля: успех, новый работает, старый нет, refresh сгорел", async () => {
  const app = makeApp();
  const t = await register(app, "pw@b.c");

  const res = await app.inject({
    method: "POST", url: "/auth/password",
    headers: { authorization: `Bearer ${t.access}` },
    payload: { oldPassword: "old-pass-123", newPassword: "new-pass-456" },
  });
  assert.equal(res.statusCode, 200);

  // Новый пароль пускает, старый — нет.
  const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "pw@b.c", password: "new-pass-456" } });
  assert.equal(login.statusCode, 200);
  const oldLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "pw@b.c", password: "old-pass-123" } });
  assert.equal(oldLogin.statusCode, 401);

  // Старый refresh-токен сгорел: другие устройства разлогинены.
  const refresh = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: t.refresh } });
  assert.equal(refresh.statusCode, 401);
});

test("смена пароля: неверный текущий — 403, слабый новый — 400, без токена — 401", async () => {
  const app = makeApp();
  const t = await register(app, "pw2@b.c");
  const auth = { authorization: `Bearer ${t.access}` };

  const wrong = await app.inject({ method: "POST", url: "/auth/password", headers: auth, payload: { oldPassword: "не тот", newPassword: "new-pass-456" } });
  assert.equal(wrong.statusCode, 403);
  assert.equal(wrong.json().error, "wrong_password");

  const weak = await app.inject({ method: "POST", url: "/auth/password", headers: auth, payload: { oldPassword: "old-pass-123", newPassword: "123" } });
  assert.equal(weak.statusCode, 400);

  const anon = await app.inject({ method: "POST", url: "/auth/password", payload: { oldPassword: "x", newPassword: "new-pass-456" } });
  assert.equal(anon.statusCode, 401);

  // Пароль не изменился.
  const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "pw2@b.c", password: "old-pass-123" } });
  assert.equal(login.statusCode, 200);
});
