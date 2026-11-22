/**
 * Работа с датами в локальном часовом поясе.
 * Все даты приложения — строки формата YYYY-MM-DD.
 * Неделя начинается с понедельника.
 */

export const pad = (n: number): string => String(n).padStart(2, "0");

/** Разбирает YYYY-MM-DD в локальную полночь. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/** Форматирует Date в YYYY-MM-DD (локальное время). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Сдвигает дату на n дней. */
export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Индекс дня недели, где понедельник = 0, воскресенье = 6. */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Семь дат недели (Пн–Вс), в которую попадает anchor. */
export function weekOf(anchor: string): string[] {
  const monday = addDays(anchor, -mondayIndex(parseYmd(anchor)));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Сетка месяца для календаря: null — пустая ячейка до первого дня,
 * иначе дата. Первый столбец — понедельник.
 */
export function monthGrid(year: number, month0: number): Array<string | null> {
  const first = new Date(year, month0, 1);
  const offset = mondayIndex(first);
  const daysIn = new Date(year, month0 + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= daysIn; d++) {
    cells.push(ymd(new Date(year, month0, d)));
  }
  return cells;
}
