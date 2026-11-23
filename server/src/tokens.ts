import { createHash, randomBytes } from "node:crypto";

/**
 * Непрозрачные токены: случайная строка, в базе хранится только SHA-256 от неё.
 * Утечка базы не даёт токенов, токен можно отозвать удалением строки.
 * Access живёт 15 минут, refresh — 30 дней, при продлении refresh ротируется.
 */
export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
