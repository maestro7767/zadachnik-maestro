import type { UserData } from "../data/model.ts";
import type { KeyValueStore } from "../data/storage.ts";
import { ApiError, type SyncApi } from "./api.ts";
import { diffEntities, flattenUserData, type EntityEntry } from "./diff.ts";
import { enqueue, loadOutbox, removeAcked, saveOutbox } from "./outbox.ts";

/**
 * Движок синхронизации: следит за локальными правками, отправляет их
 * на сервер (outbox + повторные попытки с backoff) и забирает удалённые
 * изменения. Сеть и таймеры подменяемы — вся логика тестируется без сервера.
 */

export type SyncStatus = "ok" | "syncing" | "offline" | "unauthorized";

export interface CloudSession {
  readonly email: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: number;
}

export interface EngineDeps {
  readonly api: SyncApi;
  readonly store: KeyValueStore;
  /** Ключ хранилища для состояния (на пользователя), напр. "maestro-sync-a@b.c". */
  readonly storageKey: string;
  session: CloudSession;
  nowIso?: () => string;
  nowMs?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
  /** Удалённые изменения: UI применяет их к данным и затем вызывает noteSnapshot. */
  onRemote?: (changes: readonly EntityEntry[]) => void;
  onStatus?: (status: SyncStatus) => void;
  /** Сервер продлил токены — UI сохраняет новую сессию. */
  onSession?: (session: CloudSession) => void;
  /** Refresh-токен отклонён: нужен повторный вход. */
  onAuthLost?: () => void;
}

interface PersistedState {
  readonly since: string | null;
  readonly snapshot: EntityEntry[];
}

const DEBOUNCE_MS = 800;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 60_000;
const MAX_BATCH = 500;
/** Запас к истечению access-токена, чтобы не угодить в гонку на границе. */
const EXPIRY_MARGIN_MS = 10_000;

export class SyncEngine {
  private readonly deps: EngineDeps;
  private since: string | null = null;
  private snapshot: EntityEntry[] = [];
  private outbox: EntityEntry[] = [];
  private retryCount = 0;
  private timer: unknown = null;
  private inFlight: Promise<void> | null = null;
  private status: SyncStatus = "ok";

  constructor(deps: EngineDeps) {
    this.deps = deps;
    try {
      const raw = deps.store.getItem(deps.storageKey);
      if (raw) {
        const state = JSON.parse(raw) as PersistedState;
        this.since = typeof state.since === "string" ? state.since : null;
        this.snapshot = Array.isArray(state.snapshot) ? state.snapshot : [];
      }
    } catch {
      // Испорченное состояние — начинаем с полной выгрузки.
      this.since = null;
      this.snapshot = [];
    }
    this.outbox = loadOutbox(deps.store, deps.storageKey + "-outbox");
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  get pendingCount(): number {
    return this.outbox.length;
  }

  /** Первый запуск после входа: since ещё нет — полная выгрузка с сервера. */
  needsInitialPull(): boolean {
    return this.since === null;
  }

  /**
   * UI сообщает о локальных правках: считаем diff против снимка,
   * кладём в outbox и планируем отправку.
   */
  notifyLocal(data: UserData): void {
    const next = flattenUserData(data);
    const changes = diffEntities(this.snapshot, next, this.nowIso());
    this.snapshot = next;
    if (changes.length > 0) {
      this.outbox = enqueue(this.outbox, changes);
      this.persist();
      this.schedule(DEBOUNCE_MS);
    }
  }

  /** Первый вход: отправить все локальные данные на пустой сервер. */
  uploadAll(data: UserData): void {
    const all = flattenUserData(data).filter((e) => !e.deletedAt);
    this.outbox = enqueue(this.outbox, all);
    this.persist();
    this.schedule(DEBOUNCE_MS);
  }

  /**
   * UI применил удалённые изменения к данным — обновляем снимок,
   * чтобы они не уехали обратно как «локальные правки».
   */
  noteSnapshot(data: UserData): void {
    this.snapshot = flattenUserData(data);
    this.persist();
  }

  /** Полный цикл: отправить очередь, затем забрать удалённые изменения. */
  async syncNow(): Promise<void> {
    await this.flush();
    await this.pull();
  }

  /** Первая синхронизация после входа. Возвращает число полученных изменений. */
  async initialPull(): Promise<number> {
    const res = await this.call(() => this.deps.api.pull(this.deps.session.accessToken, null));
    this.since = res.now;
    this.persist();
    if (res.changes.length > 0) this.deps.onRemote?.(res.changes);
    return res.changes.length;
  }

  /** Отправка outbox. Повторные вызовы во время отправки схлопываются. */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doFlush().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doFlush(): Promise<void> {
    while (this.outbox.length > 0) {
      const batch = this.outbox.slice(0, MAX_BATCH);
      try {
        const res = await this.call(() => this.deps.api.push(this.deps.session.accessToken, batch));
        // Все присланные изменения сервер рассмотрел: applied/skipped/rejected — снимаем с очереди.
        const acked = res.results
          .filter((r): r is typeof r & { coll: string; id: string } => r.coll !== null && r.id !== null)
          .map((r) => ({ coll: r.coll, id: r.id }));
        this.outbox = removeAcked(this.outbox, acked);
        this.persist();
        this.setStatus("ok");
        this.retryCount = 0;
      } catch (e) {
        if (this.handleAuthError(e)) return;
        this.setStatus("offline");
        this.scheduleRetry();
        return;
      }
    }
  }

  private async pull(): Promise<void> {
    try {
      const res = await this.call(() => this.deps.api.pull(this.deps.session.accessToken, this.since));
      this.since = res.now;
      this.persist();
      if (res.changes.length > 0) this.deps.onRemote?.(res.changes);
      this.setStatus("ok");
      this.retryCount = 0;
    } catch (e) {
      if (this.handleAuthError(e)) return;
      this.setStatus("offline");
      this.scheduleRetry();
    }
  }

  /** Общая обёртка для вызовов с обработкой 401: продлить и повторить один раз. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureFreshToken();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // 401 от самого refresh улетает наверх сразу — повторять нечего.
        await this.refreshSession();
        return await fn();
      }
      throw e;
    }
  }

  private async ensureFreshToken(): Promise<void> {
    const nowMs = this.deps.nowMs ?? (() => Date.now());
    if (this.deps.session.accessExpiresAt - EXPIRY_MARGIN_MS <= nowMs()) {
      await this.refreshSession();
    }
  }

  private async refreshSession(): Promise<void> {
    try {
      const tokens = await this.deps.api.refresh(this.deps.session.refreshToken);
      this.deps.session = { ...this.deps.session, ...tokens };
      this.deps.onSession?.(this.deps.session);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 400)) {
        this.setStatus("unauthorized");
        this.deps.onAuthLost?.();
        throw e;
      }
      this.setStatus("offline");
      throw e;
    }
  }

  /** Возвращает true, если ошибка — отказ авторизации (дальше ретраить бессмысленно). */
  private handleAuthError(e: unknown): boolean {
    if (e instanceof ApiError && e.status === 401) {
      if (this.status !== "unauthorized") {
        this.setStatus("unauthorized");
        this.deps.onAuthLost?.();
      }
      return true;
    }
    return false;
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    const setTimeoutFn = this.deps.setTimeoutFn ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timer = setTimeoutFn(() => {
      this.timer = null;
      void this.flush().then(() => this.pull());
    }, delayMs);
  }

  private scheduleRetry(): void {
    this.retryCount += 1;
    const delay = Math.min(RETRY_BASE_MS * 2 ** (this.retryCount - 1), RETRY_MAX_MS);
    this.schedule(delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      (this.deps.clearTimeoutFn ?? ((h: unknown) => clearTimeout(h as Parameters<typeof clearTimeout>[0])))(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.clearTimer();
  }

  private setStatus(s: SyncStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.deps.onStatus?.(s);
    }
  }

  private nowIso(): string {
    return (this.deps.nowIso ?? (() => new Date().toISOString()))();
  }

  private persist(): void {
    try {
      this.deps.store.setItem(this.deps.storageKey, JSON.stringify({ since: this.since, snapshot: this.snapshot }));
    } catch {
      // Переполнение хранилища — состояние пересчитается при следующем запуске.
    }
    saveOutbox(this.deps.store, this.deps.storageKey + "-outbox", this.outbox);
  }
}
