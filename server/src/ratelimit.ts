/**
 * Ограничитель частоты запросов: не больше limit обращений за windowMs на ключ
 * (ключ — IP для входа/регистрации). Скользящее окно в памяти процесса.
 * Для одного инстанса сервера достаточно; при горизонтальном масштабировании
 * заменить на общее хранилище.
 */
export interface RateLimiter {
  /** true — запрос разрешён, false — лимит исчерпан. */
  hit(key: string, now: number): boolean;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key: string, now: number): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
