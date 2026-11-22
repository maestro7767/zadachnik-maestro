import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekday, lessonsOn } from "../src/study/lessons.ts";
import { daysLeft, upcomingDeadlines } from "../src/study/deadlines.ts";
import { pomodoroAt, skipPomodoro, WORK_SEC, SHORT_SEC, LONG_SEC } from "../src/study/pomodoro.ts";
import { reviewCard, dueCards, BOX_INTERVALS_DAYS } from "../src/study/flashcards.ts";
import { schoolAverage, collegeResult, collegeNextStep, universityResult, attendanceBonus } from "../src/study/grades.ts";
import { schoolWeight, subjectResultView } from "../src/study/journal.ts";
import { emptyStudy } from "../src/study/model.ts";

// Понедельник, 16 ноября 2026 года.
const TODAY = "2026-11-16";

test("isoWeekday: понедельник — 1, воскресенье — 7", () => {
  assert.equal(isoWeekday(TODAY), 1);
  assert.equal(isoWeekday("2026-11-15"), 7);
});

test("занятия на день фильтруются по weekday и сортируются по началу", () => {
  const lessons = [
    { id: "a", weekday: 1, start: "11:00", end: "12:30", subject: "Физика" },
    { id: "b", weekday: 1, start: "09:00", end: "10:30", subject: "Математика" },
    { id: "c", weekday: 2, start: "09:00", end: "10:30", subject: "Химия" },
  ];
  assert.deepEqual(lessonsOn(lessons, TODAY).map((l) => l.id), ["b", "a"]);
  assert.deepEqual(lessonsOn(lessons, "2026-11-18"), []);
});

test("daysLeft: 0 — сегодня, отрицательное — срок прошёл", () => {
  assert.equal(daysLeft(TODAY, TODAY), 0);
  assert.equal(daysLeft("2026-11-20", TODAY), 4);
  assert.equal(daysLeft("2026-11-10", TODAY), -6);
});

test("ближайшие дедлайны в окне и по сроку", () => {
  const dl = [
    { id: "a", title: "Эссе", due: "2026-11-25" },
    { id: "b", title: "Лаба", due: "2026-11-17" },
    { id: "c", title: "Старое", due: "2026-11-01" },
    { id: "d", title: "Далёкое", due: "2026-12-31" },
  ];
  assert.deepEqual(upcomingDeadlines(dl, TODAY, 14).map((d) => d.id), ["b", "a"]);
});

test("помодоро: работа 25 минут, затем короткий отдых", () => {
  assert.deepEqual(pomodoroAt(0), { phase: "work", index: 0, remainingSec: WORK_SEC, phaseEndSec: WORK_SEC });
  const rest = pomodoroAt(WORK_SEC);
  assert.equal(rest.phase, "short");
  assert.equal(rest.remainingSec, SHORT_SEC);
});

test("помодоро: после четвёртой работы длинный отдых", () => {
  const startOfFourthRest = 4 * WORK_SEC + 3 * SHORT_SEC;
  const st = pomodoroAt(startOfFourthRest);
  assert.equal(st.phase, "long");
  assert.equal(st.remainingSec, LONG_SEC);
});

test("пропуск фазы помодоро переводит на начало следующей", () => {
  const startMs = 1_000_000;
  const nowMs = startMs + 60_000;
  const newStart = skipPomodoro(startMs, nowMs);
  assert.equal(pomodoroAt(Math.floor((nowMs - newStart) / 1000)).index, 1);
});

test("карточка: «помню» двигает коробку вперёд, «не помню» — в начало", () => {
  const card = { id: "a", front: "Q", back: "A", box: 1, due: TODAY };
  const good = reviewCard(card, true, TODAY);
  assert.equal(good.box, 2);
  assert.equal(good.due, "2026-11-23"); // +7 дней
  const bad = reviewCard(card, false, TODAY);
  assert.equal(bad.box, 0);
  assert.equal(bad.due, "2026-11-17"); // +1 день
});

test("карточка в последней коробке остаётся в ней", () => {
  const last = BOX_INTERVALS_DAYS.length - 1;
  const card = reviewCard({ id: "a", front: "", back: "", box: last, due: TODAY }, true, TODAY);
  assert.equal(card.box, last);
  assert.equal(card.due, "2026-12-16"); // +30 дней
});

test("повторять сегодня: срок наступил, по дате", () => {
  const cards = [
    { id: "a", front: "", back: "", box: 0, due: "2026-11-16" },
    { id: "b", front: "", back: "", box: 0, due: "2026-11-10" },
    { id: "c", front: "", back: "", box: 0, due: "2026-11-20" },
  ];
  assert.deepEqual(dueCards(cards, TODAY).map((c) => c.id), ["b", "a"]);
});

test("школа: средневзвешенный балл, округление .5 вверх", () => {
  assert.equal(schoolAverage([]), null);
  const r = schoolAverage([{ value: 4, weight: 1 }, { value: 5, weight: 2 }]);
  if (r === null) throw new Error("не ожидался null");
  assert.equal(r.average, 4.67);
  assert.equal(r.grade, 5);
});

test("вес работ в школе: контрольная и экзамен ×2", () => {
  assert.equal(schoolWeight("homework"), 1);
  assert.equal(schoolWeight("checkpoint"), 1);
  assert.equal(schoolWeight("test"), 2);
  assert.equal(schoolWeight("exam"), 2);
});

test("колледж: бонус посещаемости только со второго курса", () => {
  assert.equal(attendanceBonus(90), 18);
  const first = collegeResult(70, 100, false);
  assert.ok(!("error" in first));
  if ("error" in first) return;
  assert.equal(first.attendance, 0);
  assert.equal(first.total, 70);
  const second = collegeResult(70, 100, true);
  assert.ok(!("error" in second));
  if ("error" in second) return;
  assert.equal(second.attendance, 20);
  assert.equal(second.total, 90);
  assert.equal(second.grade, 5);
});

test("колледж: ошибка при баллах вне 0–100", () => {
  assert.ok("error" in collegeResult(101, 0, false));
  assert.ok("error" in collegeResult(-5, 0, false));
});

test("колледж: незачёт ниже 50 и шаги дальше", () => {
  const r = collegeResult(45, 0, false);
  if ("error" in r) throw new Error("не ожидалось ошибки");
  assert.equal(r.grade, null);
  assert.equal(r.passed, false);
  assert.equal(collegeNextStep(0, false), "retake");
  assert.equal(collegeNextStep(1, false), "commission");
  assert.equal(collegeNextStep(3, false), "expulsion");
  assert.equal(collegeNextStep(0, true), "none");
});

test("вуз: пороги БРС и зачёт", () => {
  assert.deepEqual(universityResult(85), { total: 85, grade: 4, passed: true });
  assert.deepEqual(universityResult(59), { total: 59, grade: 2, passed: false });
  assert.ok("error" in universityResult(150));
});

test("результат по предмету для каждого заведения", () => {
  const items = [{ value: 5, kind: "homework" as const }, { value: 4, kind: "test" as const }];
  assert.deepEqual(subjectResultView(null, items, 0, false, 0), { kind: "empty", text: "выбери учебное заведение" });
  assert.deepEqual(subjectResultView("school", [], 0, false, 0), { kind: "empty", text: "оценок пока нет" });

  const school = subjectResultView("school", items, 0, false, 0);
  assert.equal(school.kind, "grade");
  if (school.kind === "grade") assert.equal(school.grade, 4);

  const uni = subjectResultView("university", [{ value: 45, kind: "test" }, { value: 50, kind: "exam" }], 0, false, 0);
  assert.equal(uni.kind, "grade");
  if (uni.kind === "grade") assert.equal(uni.grade, 5);

  const college = subjectResultView("college", [{ value: 30, kind: "test" }], 0, false, 0);
  assert.equal(college.kind, "next");
  if (college.kind === "next") assert.equal(college.step, "retake");
});

test("пустые учебные данные по умолчанию", () => {
  const s = emptyStudy();
  assert.equal(s.institution, null);
  assert.deepEqual(s.subjects, []);
  assert.deepEqual(s.cards, []);
});
