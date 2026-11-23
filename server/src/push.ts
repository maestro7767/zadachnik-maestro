import { sendNotification, setVapidDetails } from "web-push";
import type { Db } from "./db.ts";

/** VAPID-ключи: публичный уходит клиенту, приватный никогда не покидает сервер. */
export interface VapidConfig {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

/** Подписка в формате PushSubscription браузера (после .toJSON()). */
export interface PushSubscriptionDto {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** Функция отправки — в тестах подменяется, в бою зовёт web-push. */
export type PushSend = (sub: PushSubscriptionDto, payload: string) => Promise<void>;

export function createPushSender(vapid: VapidConfig): PushSend {
  setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return (sub, payload) =>
    sendNotification({ endpoint: sub.endpoint, keys: { ...sub.keys } }, payload).then(() => undefined);
}

/** Валидация подписки: без endpoint и ключей шифрования пуш не доставить. */
export function validateSubscription(raw: unknown): PushSubscriptionDto | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const keys = s.keys as Record<string, unknown> | null;
  if (typeof s.endpoint !== "string" || s.endpoint.length > 2048 || !s.endpoint.startsWith("https://")) return null;
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  if (keys.p256dh.length > 512 || keys.auth.length > 512) return null;
  return { endpoint: s.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function saveSubscription(db: Db, userId: string, sub: PushSubscriptionDto, tzOffset: number | null = null): void {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, tz_offset)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, tz_offset = excluded.tz_offset`,
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, new Date().toISOString(), tzOffset);
}

export function removeSubscription(db: Db, userId: string, endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").run(userId, endpoint);
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function listSubscriptions(db: Db, userId: string): PushSubscriptionDto[] {
  const rows = db
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as unknown as SubRow[];
  return rows.map((r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));
}

/**
 * Шлёт пуш всем устройствам пользователя.
 * Подписки, которые push-сервис признал мёртвыми (404/410), вычищаем сразу.
 */
export async function sendToUser(
  db: Db,
  send: PushSend,
  userId: string,
  payload: string,
): Promise<{ sent: number; failed: number; removed: number }> {
  const subs = listSubscriptions(db, userId);
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (const sub of subs) {
    try {
      await send(sub, payload);
      sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(sub.endpoint);
        removed += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { sent, failed, removed };
}
