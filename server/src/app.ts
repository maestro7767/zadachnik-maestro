import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { generateToken, tokenHash, ACCESS_TTL_MS, REFRESH_TTL_MS } from "./tokens.ts";
import { createRateLimiter } from "./ratelimit.ts";
import { MAX_PUSH_CHANGES, applyChange, normalizeIso, pullSince, validateChange } from "./sync.ts";
import { createPushSender, removeSubscription, saveSubscription, sendToUser, validateSubscription } from "./push.ts";
import type { PushSend, VapidConfig } from "./push.ts";
import { decomposeWithLLM } from "./ai.ts";
import type { AiConfig, ChatFetch } from "./ai.ts";
import { addTask, createRoom, deleteRoom, deleteTask, joinRoom, leaveRoom, listRooms, listTasks, roleOf, roomDetail, setWeeklyGoal, toggleTask } from "./rooms.ts";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;
const MIN_NAME_LEN = 2;
const MAX_NAME_LEN = 30;

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Момент истечения access-токена, unix ms. */
  readonly accessExpiresAt: number;
}

export interface BuildOptions {
  /** Часы — для тестов, чтобы устаревать токены без ожидания. */
  nowMs?: () => number;
  /** Лимит попыток входа/регистрации с одного IP: limit за windowMs. */
  rateLimit?: { limit: number; windowMs: number };
  /** Разрешённый источник CORS. По умолчанию "*" — API без cookie, авторизация по Bearer. */
  corsOrigin?: string;
  /** VAPID-ключи для Web Push. Без них push-эндпоинты отвечают 503. */
  vapid?: VapidConfig;
  /** Отправка пуша — в тестах подменяется моком. */
  pushSend?: PushSend;
  /** Настройки LLM для разложения целей. Без них /ai/decompose отвечает 503. */
  ai?: AiConfig;
  /** fetch для вызова LLM — в тестах подменяется. */
  aiFetch?: ChatFetch;
}

interface TokenRow {
  user_id: string;
  kind: string;
  expires_at: number;
}

interface UserRow {
  id: string;
  email: string;
  pass_hash: string;
  name: string;
}

/**
 * Собирает приложение Fastify поверх открытой базы.
 * Чистые решения (хеши, токены, лимиты) вынесены в свои модули; здесь — HTTP-слой.
 */
export function buildApp(db: Db, opts: BuildOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const nowMs = opts.nowMs ?? (() => Date.now());
  const limiter = createRateLimiter(opts.rateLimit?.limit ?? 10, opts.rateLimit?.windowMs ?? 10 * 60_000);
  const corsOrigin = opts.corsOrigin ?? "*";

  // CORS: клиент живёт на GitHub Pages, сервер — на своём хостинге.
  // Cookie не используются, авторизация по Bearer-токену, поэтому "*" безопасен.
  app.addHook("onSend", async (req, reply) => {
    reply.header("access-control-allow-origin", corsOrigin);
    reply.header("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    reply.header("access-control-allow-headers", "authorization, content-type");
  });
  app.options("/*", (req, reply) => reply.code(204).send());

  /** Хеш-заглушка: на несуществующий email тратим столько же времени, чтобы не раскрывать, какие адреса заняты. */
  let dummyHash: string | null = null;
  const getDummyHash = async (): Promise<string> => {
    if (!dummyHash) dummyHash = await hashPassword(randomUUID());
    return dummyHash;
  };

  function issueTokens(userId: string): TokenPair {
    const access = generateToken(32);
    const refresh = generateToken(48);
    const now = nowMs();
    const createdAt = new Date(now).toISOString();
    const ins = db.prepare(
      "INSERT INTO tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    ins.run(tokenHash(access), userId, "access", now + ACCESS_TTL_MS, createdAt);
    ins.run(tokenHash(refresh), userId, "refresh", now + REFRESH_TTL_MS, createdAt);
    db.prepare("DELETE FROM tokens WHERE expires_at <= ?").run(now);
    return { accessToken: access, refreshToken: refresh, accessExpiresAt: now + ACCESS_TTL_MS };
  }

  function findToken(token: string, kind: string): TokenRow | undefined {
    return db
      .prepare("SELECT user_id, kind, expires_at FROM tokens WHERE token_hash = ? AND kind = ?")
      .get(tokenHash(token), kind) as TokenRow | undefined;
  }

  function findUserByEmail(email: string): UserRow | undefined {
    return db.prepare("SELECT id, email, pass_hash, name FROM users WHERE email = ?").get(email) as UserRow | undefined;
  }

  function bearerUserId(req: FastifyRequest): string | null {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return null;
    const row = findToken(header.slice(7), "access");
    if (!row || row.expires_at <= nowMs()) return null;
    return row.user_id;
  }

  function credentialsOf(body: unknown): { email: string; password: string } | null {
    if (typeof body !== "object" || body === null) return null;
    const b = body as Record<string, unknown>;
    if (typeof b.email !== "string" || typeof b.password !== "string") return null;
    return { email: b.email.trim().toLowerCase(), password: b.password };
  }

  app.post("/auth/register", async (req, reply) => {
    if (!limiter.hit(req.ip, nowMs())) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    const creds = credentialsOf(req.body);
    if (!creds || !EMAIL_RX.test(creds.email) || creds.email.length > 254) {
      return reply.code(400).send({ error: "invalid_email" });
    }
    if (creds.password.length < MIN_PASSWORD_LEN || creds.password.length > MAX_PASSWORD_LEN) {
      return reply.code(400).send({ error: "weak_password" });
    }
    // Ник — необязателен для API (клиент требует его на форме), но если передан — проверяем.
    const rawName = (req.body as Record<string, unknown> | null)?.name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (name.length > 0 && (name.length < MIN_NAME_LEN || name.length > MAX_NAME_LEN)) {
      return reply.code(400).send({ error: "invalid_name" });
    }
    if (findUserByEmail(creds.email)) {
      return reply.code(409).send({ error: "email_taken" });
    }
    const id = randomUUID();
    const passHash = await hashPassword(creds.password);
    db.prepare("INSERT INTO users (id, email, pass_hash, name, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      creds.email,
      passHash,
      name,
      new Date(nowMs()).toISOString(),
    );
    return reply.code(201).send({ userId: id, name, ...issueTokens(id) });
  });

  app.post("/auth/login", async (req, reply) => {
    if (!limiter.hit(req.ip, nowMs())) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    const creds = credentialsOf(req.body);
    if (!creds) {
      return reply.code(400).send({ error: "invalid_input" });
    }
    const user = findUserByEmail(creds.email);
    const hash = user ? user.pass_hash : await getDummyHash();
    const ok = await verifyPassword(hash, creds.password);
    // Одинаковый ответ на «нет такого email» и «неверный пароль»: не раскрываем занятые адреса.
    if (!user || !ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    return reply.send({ userId: user.id, name: user.name, ...issueTokens(user.id) });
  });

  app.post("/auth/refresh", (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    const token = body && typeof body.refreshToken === "string" ? body.refreshToken : null;
    const row = token ? findToken(token, "refresh") : undefined;
    if (!row || row.expires_at <= nowMs()) {
      return reply.code(401).send({ error: "invalid_token" });
    }
    // Ротация: старый refresh сгорает, выдаём новую пару.
    db.prepare("DELETE FROM tokens WHERE token_hash = ?").run(tokenHash(token!));
    return reply.send(issueTokens(row.user_id));
  });

  app.post("/auth/logout", (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (body && typeof body.refreshToken === "string") {
      db.prepare("DELETE FROM tokens WHERE token_hash = ?").run(tokenHash(body.refreshToken));
    }
    return reply.send({ ok: true });
  });

  // Смена пароля по текущему. Лимит как на вход: старый пароль не перебрать.
  app.post("/auth/password", async (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!limiter.hit(userId, nowMs())) return reply.code(429).send({ error: "rate_limited" });
    const body = req.body as Record<string, unknown> | null;
    const oldPassword = typeof body?.oldPassword === "string" ? body.oldPassword : "";
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < MIN_PASSWORD_LEN || newPassword.length > MAX_PASSWORD_LEN) {
      return reply.code(400).send({ error: "weak_password" });
    }
    const user = db.prepare("SELECT pass_hash FROM users WHERE id = ?").get(userId) as { pass_hash: string } | undefined;
    if (!user || !(await verifyPassword(user.pass_hash, oldPassword))) {
      return reply.code(403).send({ error: "wrong_password" });
    }
    const passHash = await hashPassword(newPassword);
    db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(passHash, userId);
    // После смены пароля сессии на других устройствах умирают: refresh-токены сжигаем.
    // Текущий access-токен доживает свой срок, клиент тут же получит новую пару при синке.
    db.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'refresh'").run(userId);
    return reply.send({ ok: true });
  });

  app.get("/healthz", () => ({ ok: true }));

  app.get("/me", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const user = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(userId) as UserRow | undefined;
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send({ userId: user.id, email: user.email, name: user.name });
  });

  app.get("/sync/pull", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const query = req.query as Record<string, unknown>;
    let since: string | null = null;
    if (typeof query.since === "string" && query.since !== "") {
      since = normalizeIso(query.since);
      if (!since) {
        return reply.code(400).send({ error: "invalid_since" });
      }
    }
    return reply.send({ now: new Date(nowMs()).toISOString(), changes: pullSince(db, userId, since) });
  });

  app.post("/sync/push", { bodyLimit: 5 * 1024 * 1024 }, (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const body = req.body as Record<string, unknown> | null;
    if (!body || !Array.isArray(body.changes)) {
      return reply.code(400).send({ error: "invalid_input" });
    }
    if (body.changes.length > MAX_PUSH_CHANGES) {
      return reply.code(400).send({ error: "too_many_changes" });
    }
    // Каждое изменение проверяется отдельно: невалидные отклоняем, валидные применяем.
    const results = (body.changes as unknown[]).map((raw) => {
      const v = validateChange(raw);
      if (!v.ok) {
        const r = raw as Record<string, unknown> | null;
        return {
          coll: typeof r?.coll === "string" ? r.coll : null,
          id: typeof r?.id === "string" ? r.id : null,
          status: "rejected" as const,
          error: v.error,
        };
      }
      return { coll: v.change.coll, id: v.change.id, status: applyChange(db, userId, v.change) };
    });
    return reply.send({ now: new Date(nowMs()).toISOString(), results });
  });

  /* --- Web Push --- */
  const vapid = opts.vapid ?? null;
  const pushSend: PushSend | null = vapid ? (opts.pushSend ?? createPushSender(vapid)) : null;

  // Публичный VAPID-ключ не секретный: клиенту он нужен для подписки.
  app.get("/push/vapid", (req, reply) => {
    if (!vapid) return reply.code(503).send({ error: "push_not_configured" });
    return reply.send({ publicKey: vapid.publicKey });
  });

  app.post("/push/subscribe", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!vapid) return reply.code(503).send({ error: "push_not_configured" });
    const sub = validateSubscription((req.body as Record<string, unknown> | null)?.subscription);
    if (!sub) return reply.code(400).send({ error: "invalid_subscription" });
    // Часовой пояс устройства (минуты, как getTimezoneOffset) — для серверных напоминаний.
    const rawTz = (req.body as Record<string, unknown> | null)?.tzOffset;
    const tzOffset = typeof rawTz === "number" && Number.isFinite(rawTz) && Math.abs(rawTz) <= 840 ? Math.round(rawTz) : null;
    saveSubscription(db, userId, sub, tzOffset);
    return reply.code(201).send({ ok: true });
  });

  app.post("/push/unsubscribe", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const endpoint = (req.body as Record<string, unknown> | null)?.endpoint;
    if (typeof endpoint === "string") removeSubscription(db, userId, endpoint);
    return reply.send({ ok: true });
  });

  // Тестовый пуш: пользователь сразу видит, что уведомления доходят.
  app.post("/push/test", async (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!vapid || !pushSend) return reply.code(503).send({ error: "push_not_configured" });
    const payload = JSON.stringify({ title: "Задачник Маэстро", body: "Пуши работают! 🎉", url: "./" });
    const result = await sendToUser(db, pushSend, userId, payload);
    return reply.send(result);
  });

  /* --- ИИ-помощник: разложение цели на шаги --- */
  const ai = opts.ai ?? null;
  const aiFetch = opts.aiFetch ?? (fetch as unknown as ChatFetch);
  // Отдельный строгий лимит: вызовы LLM стоят денег. 5 запросов в минуту на пользователя.
  const aiLimiter = createRateLimiter(5, 60_000);

  app.post("/ai/decompose", async (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    if (!ai) return reply.code(503).send({ error: "ai_not_configured" });
    if (!aiLimiter.hit(userId, nowMs())) return reply.code(429).send({ error: "rate_limited" });

    const body = req.body as Record<string, unknown> | null;
    const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
    if (goal.length < 3 || goal.length > 300) return reply.code(400).send({ error: "invalid_goal" });
    const startDate = typeof body?.startDate === "string" ? body.startDate : "";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "";
    const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_RX.test(startDate) || !DATE_RX.test(endDate) || startDate > endDate) {
      return reply.code(400).send({ error: "invalid_dates" });
    }
    const spanDays = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
    if (spanDays > 90) return reply.code(400).send({ error: "range_too_long" });

    // Нагрузка по дням: только валидные записи, не больше сотни.
    const load: Record<string, number> = {};
    const rawLoad = body?.load;
    if (typeof rawLoad === "object" && rawLoad !== null) {
      for (const [k, v] of Object.entries(rawLoad as Record<string, unknown>)) {
        if (DATE_RX.test(k) && typeof v === "number" && v > 0 && v < 100 && Object.keys(load).length < 100) {
          load[k] = Math.round(v);
        }
      }
    }

    try {
      const steps = await decomposeWithLLM(ai, { goal, startDate, endDate, load }, aiFetch);
      return reply.send({ steps });
    } catch {
      return reply.code(502).send({ error: "ai_failed" });
    }
  });

  /* --- Совместные комнаты --- */
  const nowIso = () => new Date(nowMs()).toISOString();
  const ROOM_NAME_MIN = 2;
  const ROOM_NAME_MAX = 40;
  const ROOM_TASK_MAX = 200;
  const ROOM_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

  app.post("/rooms", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const name = (req.body as Record<string, unknown> | null)?.name;
    if (typeof name !== "string" || name.trim().length < ROOM_NAME_MIN || name.trim().length > ROOM_NAME_MAX) {
      return reply.code(400).send({ error: "invalid_name" });
    }
    return reply.code(201).send(createRoom(db, userId, name.trim(), nowIso()));
  });

  app.post("/rooms/join", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const code = (req.body as Record<string, unknown> | null)?.code;
    if (typeof code !== "string" || code.trim().length === 0 || code.trim().length > 12) {
      return reply.code(400).send({ error: "invalid_code" });
    }
    const res = joinRoom(db, userId, code, nowIso());
    if (!res.ok) {
      return reply.code(res.error === "not_found" ? 404 : 409).send({ error: res.error === "not_found" ? "invite_not_found" : "already_member" });
    }
    return reply.code(201).send({ roomId: res.roomId });
  });

  app.get("/rooms", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    return reply.send({ rooms: listRooms(db, userId, nowIso()) });
  });

  app.get("/rooms/:id", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const detail = roomDetail(db, (req.params as { id: string }).id, userId, nowIso());
    if (!detail) return reply.code(404).send({ error: "not_found" });
    return reply.send(detail);
  });

  app.get("/rooms/:id/tasks", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const roomId = (req.params as { id: string }).id;
    if (!roleOf(db, roomId, userId)) return reply.code(403).send({ error: "not_member" });
    return reply.send({ tasks: listTasks(db, roomId) });
  });

  app.post("/rooms/:id/tasks", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const roomId = (req.params as { id: string }).id;
    if (!roleOf(db, roomId, userId)) return reply.code(403).send({ error: "not_member" });
    const body = req.body as Record<string, unknown> | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text.length === 0 || text.length > ROOM_TASK_MAX) return reply.code(400).send({ error: "invalid_text" });
    const date = typeof body?.date === "string" ? body.date : "";
    if (date !== "" && !ROOM_DATE_RX.test(date)) return reply.code(400).send({ error: "invalid_date" });
    return reply.code(201).send(addTask(db, roomId, userId, text, date, nowIso()));
  });

  app.post("/rooms/:id/tasks/:tid/toggle", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const { id: roomId, tid } = req.params as { id: string; tid: string };
    if (!roleOf(db, roomId, userId)) return reply.code(403).send({ error: "not_member" });
    const task = toggleTask(db, roomId, tid, userId, nowIso());
    if (!task) return reply.code(404).send({ error: "not_found" });
    return reply.send(task);
  });

  app.delete("/rooms/:id/tasks/:tid", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const { id: roomId, tid } = req.params as { id: string; tid: string };
    const role = roleOf(db, roomId, userId);
    if (!role) return reply.code(403).send({ error: "not_member" });
    const exists = db.prepare("SELECT 1 FROM room_tasks WHERE id = ? AND room_id = ?").get(tid, roomId);
    if (!exists) return reply.code(404).send({ error: "not_found" });
    if (!deleteTask(db, roomId, tid, userId, role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return reply.send({ ok: true });
  });

  app.delete("/rooms/:id", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const roomId = (req.params as { id: string }).id;
    if (roleOf(db, roomId, userId) !== "owner") return reply.code(403).send({ error: "forbidden" });
    deleteRoom(db, roomId);
    return reply.send({ ok: true });
  });

  app.post("/rooms/:id/leave", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const roomId = (req.params as { id: string }).id;
    const role = roleOf(db, roomId, userId);
    if (!role) return reply.code(404).send({ error: "not_found" });
    if (role === "owner") return reply.code(400).send({ error: "owner_cant_leave" });
    leaveRoom(db, roomId, userId);
    return reply.send({ ok: true });
  });

  app.patch("/rooms/:id", (req, reply) => {
    const userId = bearerUserId(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });
    const roomId = (req.params as { id: string }).id;
    if (roleOf(db, roomId, userId) !== "owner") return reply.code(403).send({ error: "forbidden" });
    const goal = (req.body as Record<string, unknown> | null)?.weeklyGoal;
    if (typeof goal !== "number" || !Number.isInteger(goal) || goal < 1 || goal > 100) {
      return reply.code(400).send({ error: "invalid_goal" });
    }
    setWeeklyGoal(db, roomId, goal);
    return reply.send({ ok: true });
  });

  return app;
}
