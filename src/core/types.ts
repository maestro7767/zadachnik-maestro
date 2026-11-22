/** Категории (отделы) планов. */
export type Category = "study" | "sport" | "life";

/** План на конкретную дату. Даты в формате YYYY-MM-DD, время HH:MM или пустая строка. */
export interface Plan {
  readonly id: string;
  readonly cat: Category;
  readonly text: string;
  readonly date: string;
  readonly time: string;
  readonly done: boolean;
}

export const CATEGORY_NAMES: Readonly<Record<Category, string>> = {
  study: "Учёба",
  sport: "Спорт",
  life: "Быт",
};
