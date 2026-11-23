import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/app.ts";

test("CORS: заголовки на обычных ответах и preflight OPTIONS", async () => {
  const app = buildApp(openDb());
  const res = await app.inject({ method: "GET", url: "/me" });
  assert.equal(res.headers["access-control-allow-origin"], "*");

  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/sync/push",
    headers: { origin: "https://maestro7767.github.io", "access-control-request-headers": "authorization,content-type" },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "*");
  assert.match(String(preflight.headers["access-control-allow-headers"]), /authorization/);
});

test("CORS: источник настраивается через опцию", async () => {
  const app = buildApp(openDb(), { corsOrigin: "https://maestro7767.github.io" });
  const res = await app.inject({ method: "GET", url: "/me" });
  assert.equal(res.headers["access-control-allow-origin"], "https://maestro7767.github.io");
});
