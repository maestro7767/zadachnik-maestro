/**
 * Оценки по трём системам: школа (2–5, средневзвешенный балл),
 * колледж (100 баллов + бонус посещаемости до 20, итого до 120),
 * вуз (100-балльная БРС с порогом зачёта).
 * Все правила — параметры, их можно поменять без переписывания логики.
 */

/** Округление как в журналах: .5 вверх. */
export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/* ---------- Школа ---------- */

export interface SchoolItem {
  readonly value: number;
  readonly weight: number;
}

export interface SchoolResult {
  /** Средневзвешенный балл, округлён до сотых. */
  readonly average: number;
  /** Итоговая оценка 2–5. */
  readonly grade: number;
}

/** Средневзвешенный балл и итоговая оценка 2–5. null, если работ нет. */
export function schoolAverage(items: readonly SchoolItem[]): SchoolResult | null {
  if (items.length === 0) return null;
  const weightSum = items.reduce((s, i) => s + i.weight, 0);
  if (weightSum <= 0) return null;
  const average = items.reduce((s, i) => s + i.value * i.weight, 0) / weightSum;
  const grade = Math.min(5, Math.max(2, roundHalfUp(average)));
  return { average: Math.round(average * 100) / 100, grade };
}

/* ---------- Колледж ---------- */

/** Максимум баллов за чекпоинты и экзамены. */
export const COLLEGE_MAX_POINTS = 100;
/** Максимум бонуса за посещаемость (второй курс). */
export const COLLEGE_ATTENDANCE_MAX = 20;
/** Пороги: до 50 — неудовлетворительно, 50 — «3», 70 — «4», 90 — «5». */
export const COLLEGE_THRESHOLDS = { three: 50, four: 70, five: 90 } as const;

/** Бонус за посещаемость: процент посещаемости от 20 баллов (90% → 18). */
export function attendanceBonus(percent: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return Math.round(p * COLLEGE_ATTENDANCE_MAX / 100);
}

export interface CollegeOk {
  readonly points: number;
  readonly attendance: number;
  readonly total: number;
  readonly grade: 3 | 4 | 5 | null;
  readonly passed: boolean;
}

export type CollegeResult = CollegeOk | { readonly error: string };

/**
 * Вариант Б: бонус посещаемости входит в итог и влияет на оценку.
 * Ошибка, если баллы за работы вне 0–100.
 */
export function collegeResult(points: number, attendancePercent: number, secondYearOrAbove: boolean): CollegeResult {
  if (!Number.isFinite(points) || points < 0 || points > COLLEGE_MAX_POINTS) {
    return { error: "Баллы за работы должны быть от 0 до 100" };
  }
  const attendance = secondYearOrAbove ? attendanceBonus(attendancePercent) : 0;
  const total = points + attendance;
  const grade: 3 | 4 | 5 | null =
    total >= COLLEGE_THRESHOLDS.five ? 5
    : total >= COLLEGE_THRESHOLDS.four ? 4
    : total >= COLLEGE_THRESHOLDS.three ? 3
    : null;
  return { points, attendance, total, grade, passed: grade !== null };
}

/** Шаги после незачёта: пересдача, затем комиссия, затем отчисление. */
export type CollegeNextStep = "none" | "retake" | "commission" | "expulsion";

/**
 * Что дальше по числу неудачных попыток.
 * Зачёт — ничего; без неудач — пересдача; одна неудача — комиссия; две и больше — отчисление.
 */
export function collegeNextStep(failedAttempts: number, passed: boolean): CollegeNextStep {
  if (passed) return "none";
  if (failedAttempts <= 0) return "retake";
  if (failedAttempts === 1) return "commission";
  return "expulsion";
}

/* ---------- Вуз ---------- */

export const UNIVERSITY_DEFAULT_PASS = 60;

export type UniversityResult =
  | { readonly total: number; readonly grade: 2 | 3 | 4 | 5; readonly passed: boolean }
  | { readonly error: string };

/**
 * 100-балльная БРС: 90 — «отлично», 70 — «хорошо», 60 — «удовлетворительно».
 * Порог зачёта задаётся параметром.
 */
export function universityResult(total: number, passMark: number = UNIVERSITY_DEFAULT_PASS): UniversityResult {
  if (!Number.isFinite(total) || total < 0 || total > 100) {
    return { error: "Баллы должны быть от 0 до 100" };
  }
  const grade: 2 | 3 | 4 | 5 = total >= 90 ? 5 : total >= 70 ? 4 : total >= 60 ? 3 : 2;
  return { total, grade, passed: total >= passMark };
}
