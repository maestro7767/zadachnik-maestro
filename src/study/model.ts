/** Тип учебного заведения: от него зависит система оценок. */
export type Institution = "school" | "college" | "university";

/** Предмет в журнале. */
export interface Subject {
  id: string;
  name: string;
  /** Число неудачных попыток сдачи (колледж). */
  failedAttempts: number;
  /** Момент последнего изменения (ISO), для синхронизации. */
  updatedAt?: string;
  /** Момент удаления (ISO) — tombstone для синхронизации. */
  deletedAt?: string | null;
}

/** Тип работы в школе: домашка и контрольная точка ×1, контрольная и экзамен ×2. */
export type AssessmentKind = "homework" | "test" | "checkpoint" | "exam";

/** Записанная работа: оценка (школа) или баллы (колледж, вуз). */
export interface Assessment {
  id: string;
  subjectId: string;
  kind: AssessmentKind;
  value: number;
  date: string;
  /** Момент последнего изменения (ISO), для синхронизации. */
  updatedAt?: string;
  /** Момент удаления (ISO) — tombstone для синхронизации. */
  deletedAt?: string | null;
}

/** Занятие в расписании: weekday 1 — понедельник, 7 — воскресенье. Время HH:MM. */
export interface Lesson {
  id: string;
  weekday: number;
  start: string;
  end: string;
  subject: string;
  /** Момент последнего изменения (ISO), для синхронизации. */
  updatedAt?: string;
  /** Момент удаления (ISO) — tombstone для синхронизации. */
  deletedAt?: string | null;
}

/** Дедлайн: что сдать и до какой даты (YYYY-MM-DD). */
export interface Deadline {
  id: string;
  title: string;
  due: string;
  /** Момент последнего изменения (ISO), для синхронизации. */
  updatedAt?: string;
  /** Момент удаления (ISO) — tombstone для синхронизации. */
  deletedAt?: string | null;
}

/** Карточка для интервального повторения. */
export interface StudyCard {
  id: string;
  front: string;
  back: string;
  /** Номер коробки Лейтнера (0 — первая). */
  box: number;
  /** Дата, с которой карточку пора повторить (YYYY-MM-DD). */
  due: string;
  /** Момент последнего изменения (ISO), для синхронизации. */
  updatedAt?: string;
  /** Момент удаления (ISO) — tombstone для синхронизации. */
  deletedAt?: string | null;
}

/** Учебные данные аккаунта. Всё хранится на устройстве. */
export interface StudyData {
  institution: Institution | null;
  secondYear: boolean;
  /** Посещаемость за семестр в процентах (колледж, второй курс и выше). */
  attendance: number;
  subjects: Subject[];
  assessments: Assessment[];
  lessons: Lesson[];
  deadlines: Deadline[];
  cards: StudyCard[];
  /** Момент последнего изменения скалярных полей (заведение, курс, посещаемость), для синхронизации. */
  updatedAt?: string;
}

export function emptyStudy(): StudyData {
  return {
    institution: null,
    secondYear: false,
    attendance: 0,
    subjects: [],
    assessments: [],
    lessons: [],
    deadlines: [],
    cards: [],
  };
}
