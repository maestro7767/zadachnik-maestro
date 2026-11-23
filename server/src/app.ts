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
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
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

  return app;
}
