/**
 * Помодоро: 25 минут работы, 5 минут отдыха, после четвёртой работы — 15 минут.
 * Состояние считается по времени от старта, поэтому не сбивается при свёрнутом приложении.
 */

export type PomodoroPhase = "work" | "short" | "long";

const WORK_SEC = 25 * 60;
const SHORT_SEC = 5 * 60;
const LONG_SEC = 15 * 60;

export interface PomodoroState {
  readonly phase: PomodoroPhase;
  /** Номер фазы от старта: 0 — первая работа, 1 — первый короткий отдых и т.д. */
  readonly index: number;
  /** Сколько секунд осталось в текущей фазе. */
  readonly remainingSec: number;
  /** Секунда от старта, когда текущая фаза заканчивается. */
  readonly phaseEndSec: number;
}

function phaseOf(index: number): { phase: PomodoroPhase; sec: number } {
  if (index % 2 === 0) return { phase: "work", sec: WORK_SEC };
  const workDone = (index + 1) / 2;
  return workDone % 4 === 0 ? { phase: "long", sec: LONG_SEC } : { phase: "short", sec: SHORT_SEC };
}

/** Состояние через elapsedSec секунд после старта. */
export function pomodoroAt(elapsedSec: number): PomodoroState {
  const e = Math.max(0, elapsedSec);
  let t = 0;
  let index = 0;
  for (;;) {
    const { phase, sec } = phaseOf(index);
    if (e < t + sec) {
      return { phase, index, remainingSec: Math.ceil(t + sec - e), phaseEndSec: t + sec };
    }
    t += sec;
    index++;
  }
}

/**
 * Пропуск текущей фазы без штрафа: возвращает новое время старта,
 * при котором следующая фаза начинается сейчас.
 */
export function skipPomodoro(startMs: number, nowMs: number): number {
  const elapsed = Math.floor((nowMs - startMs) / 1000);
  const { phaseEndSec } = pomodoroAt(elapsed);
  return nowMs - phaseEndSec * 1000;
}

export { WORK_SEC, SHORT_SEC, LONG_SEC };
