import type { Habit } from "./habits.ts";

/**
 * Стартовый набор привычек. Нейтральные, без целей по весу, питанию и телу.
 * Пользователь может добавить свои или убрать эти.
 */
const STARTER_HABITS: ReadonlyArray<Pick<Habit, "id" | "name">> = [
  { id: "water", name: "Выпить стакан воды" },
  { id: "reading", name: "Почитать 10 минут" },
  { id: "walk", name: "Прогулка на свежем воздухе" },
];

/** Стартовые привычки с пустой историей отметок. */
export function starterHabits(): Habit[] {
  return STARTER_HABITS.map((h) => ({ id: h.id, name: h.name, doneDays: [] }));
}

export { STARTER_HABITS };
