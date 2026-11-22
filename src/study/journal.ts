import { collegeNextStep, collegeResult, schoolAverage, universityResult } from "./grades.ts";
import type { CollegeNextStep } from "./grades.ts";
import type { Assessment, Institution } from "./model.ts";

/** Вес работы в школе: домашка ×1, контрольная и экзамен ×2, контрольная точка ×1. */
export function schoolWeight(kind: Assessment["kind"]): number {
  return kind === "homework" || kind === "checkpoint" ? 1 : 2;
}

export type SubjectResult =
  | { readonly kind: "empty"; readonly text: string }
  | { readonly kind: "error"; readonly text: string }
  | { readonly kind: "grade"; readonly grade: number; readonly text: string }
  | { readonly kind: "next"; readonly step: CollegeNextStep; readonly text: string };

const NEXT_TEXT: Record<CollegeNextStep, string> = {
  none: "зачтено",
  retake: "нужна пересдача",
  commission: "нужна комиссия",
  expulsion: "риск отчисления: обратись к куратору",
};

/**
 * Результат по предмету для выбранного типа учебного заведения.
 * Тексты нейтральные: что дальше делать, без осуждения.
 */
export function subjectResultView(
  institution: Institution | null,
  items: ReadonlyArray<Pick<Assessment, "value" | "kind">>,
  attendancePercent: number,
  secondYear: boolean,
  failedAttempts: number,
): SubjectResult {
  if (items.length === 0) return { kind: "empty", text: "оценок пока нет" };

  if (institution === "school") {
    const r = schoolAverage(items.map((a) => ({ value: a.value, weight: schoolWeight(a.kind) })));
    if (!r) return { kind: "empty", text: "оценок пока нет" };
    return { kind: "grade", grade: r.grade, text: `${r.grade} (средний ${r.average})` };
  }

  if (institution === "college") {
    const points = items.reduce((s, a) => s + a.value, 0);
    const r = collegeResult(points, attendancePercent, secondYear);
    if ("error" in r) return { kind: "error", text: r.error };
    if (r.grade !== null) {
      return { kind: "grade", grade: r.grade, text: `${r.grade} (${r.total} из 120)` };
    }
    const step = collegeNextStep(failedAttempts, false);
    return { kind: "next", step, text: `${r.total} из 120, ${NEXT_TEXT[step]}` };
  }

  if (institution === "university") {
    const points = Math.min(100, items.reduce((s, a) => s + a.value, 0));
    const r = universityResult(points);
    if ("error" in r) return { kind: "error", text: r.error };
    return { kind: "grade", grade: r.grade, text: `${r.grade} (${r.total} из 100)` };
  }

  return { kind: "empty", text: "выбери учебное заведение" };
}
