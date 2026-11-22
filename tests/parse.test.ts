import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhen } from "../src/assistant/parse.ts";

// Понедельник, 16 ноября 2026 года.
const TODAY = "2026-11-16";

test("без даты и времени задача идёт на сегодня", () => {
  assert.deepEqual(parseWhen("сдать эссе", TODAY), { text: "Сдать эссе", date: TODAY, time: "" });
});

test("завтра и время 18:00 вычленяются из текста", () => {
  assert.deepEqual(parseWhen("сдать эссе завтра в 18:00", TODAY), {
    text: "Сдать эссе", date: "2026-11-17", time: "18:00",
  });
});

test("послезавтра", () => {
  assert.equal(parseWhen("тренировка послезавтра", TODAY).date, "2026-11-18");
});

test("сегодня с временем «в полдень»", () => {
  assert.deepEqual(parseWhen("обед сегодня в полдень", TODAY), {
    text: "Обед", date: TODAY, time: "12:00",
  });
});

test("день недели: в пятницу от понедельника", () => {
  assert.equal(parseWhen("зачёт в пятницу", TODAY).date, "2026-11-20");
});

test("день недели совпадает с сегодняшним — берётся следующая неделя", () => {
  assert.equal(parseWhen("дела в понедельник", TODAY).date, "2026-11-23");
});

test("явная дата «20 ноября»", () => {
  assert.equal(parseWhen("врач 20 ноября", TODAY).date, "2026-11-20");
});

test("дата «15.11» в прошлом переносится на следующий год", () => {
  assert.equal(parseWhen("отчёт 15.11", TODAY).date, "2027-11-15");
});

test("время «в 7 вечера» переводится в 19:00", () => {
  assert.equal(parseWhen("футбол в 7 вечера", TODAY).time, "19:00");
});

test("время «в 12 ночи» переводится в 00:00", () => {
  assert.equal(parseWhen("дописать в 12 ночи", TODAY).time, "00:00");
});

test("«в 18» без минут даёт 18:00", () => {
  assert.equal(parseWhen("созвон в 18", TODAY).time, "18:00");
});

test("слова про время не остаются в тексте задачи", () => {
  const r = parseWhen("прочитать главу 3 завтра в 9:30", TODAY);
  assert.equal(r.text, "Прочитать главу 3");
  assert.equal(r.time, "09:30");
});
