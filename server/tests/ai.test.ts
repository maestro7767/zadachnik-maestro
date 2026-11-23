import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import { parseSteps } from "../src/ai.ts";

const AI = { apiKey: "test-key", baseUrl: "https://llm.example.com/v1", model: "test-model" };
const BODY = { goal: "Подготовиться к экзамену по математике", startDate: "2026-11-23", endDate: "2026-12-13", load: { "2026-11-24": 3 } };

function makeApp(extra: Record<string, unknown> = {}) {
  const db = openDb();
  const app = buildApp(db, extra);
  return { db, app };
}

async function token(app: ReturnType<typeof buildApp>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "a@b.c", password: "s3cret-pass" } });
  return res.json().accessToken as string;
}

test("без AI-конфига — 503, без токена — 401", async () => {
  const { app } = makeApp();
  assert.equal((await app.inject({ method: "POST", url: "/ai/decompose", payload: BODY })).statusCode, 401);
  const t = await token(app);
  const res = await app.inject({ method: "POST", url: "/ai/decompose", headers: { authorization: `Bearer ${t}` }, payload: BODY });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "ai_not_configured");
});

test("валидация: цель, даты, диапазон", async () => {
  const { app } = makeApp({ ai: AI, aiFetch: async () => { throw new Error("не должно вызываться"); } });
  const t = await token(app);
  const auth = { authorization: `Bearer ${t}` };
  const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/ai/decompose", headers: auth, payload }) as unknown as Promise<{ statusCode: number }>;

  assert.equal((await post({ ...BODY, goal: "го" })).statusCode, 400);
  assert.equal((await post({ ...BODY, startDate: "23.11.2026" })).statusCode, 400);
  assert.equal((await post({ ...BODY, endDate: "2026-11-01" })).statusCode, 400);
  assert.equal((await post({ ...BODY, endDate: "2027-06-01" })).statusCode, 400); // больше 90 дней
});

test("успех: шаги из ответа модели, мусор отфильтрован", async () => {
  let seenBody = "";
  const aiFetch = async (_url: string, init: { body: string }) => {
    seenBody = init.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```json\n{"steps":[{"date":"2026-11-24","text":"Повторить дроби"},{"date":"2027-01-01","text":"ВНЕ ДИАПАЗОНА"},{"date":"плохая дата","text":"хлам"},{"date":"2026-11-26","text":"Решить 10 задач"}]}' } }],
      }),
    };
  };
  const { app } = makeApp({ ai: AI, aiFetch });
  const t = await token(app);
  const res = await app.inject({ method: "POST", url: "/ai/decompose", headers: { authorization: `Bearer ${t}` }, payload: BODY });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().steps, [
    { date: "2026-11-24", text: "Повторить дроби" },
    { date: "2026-11-26", text: "Решить 10 задач" },
  ]);
  // В промпте есть цель и нагрузка.
  assert.ok(seenBody.includes("Подготовиться к экзамену"));
  assert.ok(seenBody.includes("2026-11-24: 3 дел"));
});

test("ошибка LLM — 502, битый JSON — 502", async () => {
  const failFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const { app } = makeApp({ ai: AI, aiFetch: failFetch });
  const t = await token(app);
  const res = await app.inject({ method: "POST", url: "/ai/decompose", headers: { authorization: `Bearer ${t}` }, payload: BODY });
  assert.equal(res.statusCode, 502);

  const badJson = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "не json вообще" } }] }) });
  const { app: app2 } = makeApp({ ai: AI, aiFetch: badJson });
  const t2 = await token(app2);
  const res2 = await app2.inject({ method: "POST", url: "/ai/decompose", headers: { authorization: `Bearer ${t2}` }, payload: BODY });
  assert.equal(res2.statusCode, 502);
});

test("лимит: больше 5 запросов в минуту — 429", async () => {
  const okFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"steps":[{"date":"2026-11-24","text":"Шаг"}]}' } }] }),
  });
  const { app } = makeApp({ ai: AI, aiFetch: okFetch });
  const t = await token(app);
  const auth = { authorization: `Bearer ${t}` };
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.inject({ method: "POST", url: "/ai/decompose", headers: auth, payload: BODY })).statusCode, 200);
  }
  assert.equal((await app.inject({ method: "POST", url: "/ai/decompose", headers: auth, payload: BODY })).statusCode, 429);
});

test("parseSteps: пустой список шагов — null, больше 20 — обрезает", () => {
  assert.equal(parseSteps('{"steps":[]}', "2026-11-23", "2026-12-13"), null);
  const many = Array.from({ length: 30 }, (_, i) => ({ date: "2026-11-24", text: `Шаг ${i + 1}` }));
  const parsed = parseSteps(JSON.stringify({ steps: many }), "2026-11-23", "2026-12-13");
  assert.equal(parsed?.length, 20);
});
