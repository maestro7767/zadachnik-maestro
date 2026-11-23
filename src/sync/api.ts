/**
 * Тонкий HTTP-клиент сервера «Маэстро». Знает только про запросы и ответы;
 * состояние (токены, очереди) живёт в движке engine.ts.
 */

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Момент истечения access-токена, unix ms. */
  readonly accessExpiresAt: number;
}

export interface SyncChangeDto {
  readonly coll: string;
  readonly id: string;
  readonly payload: unknown;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export interface PushResult {
  readonly coll: string | null;
  readonly id: string | null;
  readonly status: "applied" | "skipped_stale" | "rejected";
  readonly error?: string;
}

/** Ответ с телом не 2xx. code — машинный код ошибки сервера. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`API ${status}: ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Минимальный интерфейс fetch, чтобы в тестах подменять сеть. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface SyncApi {
  register(email: string, password: string, name?: string): Promise<TokenPair & { userId: string; name: string }>;
  login(email: string, password: string): Promise<TokenPair & { userId: string; name: string }>;
  refresh(refreshToken: string): Promise<TokenPair>;
  logout(refreshToken: string): Promise<void>;
  pull(accessToken: string, since: string | null): Promise<{ now: string; changes: SyncChangeDto[] }>;
  push(accessToken: string, changes: SyncChangeDto[]): Promise<{ now: string; results: PushResult[] }>;
  getVapidKey(): Promise<{ publicKey: string }>;
  pushSubscribe(accessToken: string, subscription: unknown, tzOffset?: number): Promise<void>;
  pushUnsubscribe(accessToken: string, endpoint: string): Promise<void>;
  pushTest(accessToken: string): Promise<{ sent: number; failed: number; removed: number }>;
}

export function createApi(baseUrl: string, fetchFn: FetchLike): SyncApi {
  const base = baseUrl.replace(/\/+$/, "");

  async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<never> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchFn(base + path, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new ApiError(res.status, typeof data.error === "string" ? data.error : `http_${res.status}`);
    }
    return data as never;
  }

  return {
    register: (email, password, name) => call("POST", "/auth/register", { body: { email, password, ...(name ? { name } : {}) } }),
    login: (email, password) => call("POST", "/auth/login", { body: { email, password } }),
    refresh: (refreshToken) => call("POST", "/auth/refresh", { body: { refreshToken } }),
    logout: async (refreshToken) => {
      await call("POST", "/auth/logout", { body: { refreshToken } });
    },
    pull: (token, since) => call("GET", since ? `/sync/pull?since=${encodeURIComponent(since)}` : "/sync/pull", { token }),
    push: (token, changes) => call("POST", "/sync/push", { token, body: { changes } }),
    getVapidKey: () => call("GET", "/push/vapid"),
    pushSubscribe: async (token, subscription, tzOffset) => {
      await call("POST", "/push/subscribe", { token, body: { subscription, ...(tzOffset !== undefined ? { tzOffset } : {}) } });
    },
    pushUnsubscribe: async (token, endpoint) => {
      await call("POST", "/push/unsubscribe", { token, body: { endpoint } });
    },
    pushTest: (token) => call("POST", "/push/test", { token }),
  };
}
