/**
 * Таймер отдыха по меткам времени, а не по счётчику тиков.
 * Так таймер остаётся верным, когда приложение свернуто или экран погас:
 * оставшееся время считается от момента старта при каждом обращении.
 */

export interface RestTimer {
  /** Момент старта, миллисекунды (Date.now()). */
  readonly startedAtMs: number;
  /** Длительность отдыха в секундах. */
  readonly durationSec: number;
}

/** Сколько секунд осталось, округлено вверх, не меньше нуля. */
export function remainingSec(timer: RestTimer, nowMs: number): number {
  const elapsed = (nowMs - timer.startedAtMs) / 1000;
  return Math.max(0, Math.ceil(timer.durationSec - elapsed));
}

/** Отдых закончился. */
export function isFinished(timer: RestTimer, nowMs: number): boolean {
  return remainingSec(timer, nowMs) === 0;
}

/** Формат мм:сс для экрана. */
export function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Пропустить отдых: таймер завершается сразу в момент пропуска.
 * Возвращает новый таймер, исходный не меняется.
 */
export function skipRest(timer: RestTimer, nowMs: number): RestTimer {
  const elapsedSec = Math.max(0, (nowMs - timer.startedAtMs) / 1000);
  return { ...timer, durationSec: elapsedSec };
}
