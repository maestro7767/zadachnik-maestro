import { addDays } from "../core/date.ts";
import type { StudyCard } from "./model.ts";

/** Интервалы по коробкам: 1, 3, 7, 14 и 30 дней. */
const BOX_INTERVALS_DAYS = [1, 3, 7, 14, 30] as const;

/**
 * Один шаг повторения.
 * «Помню» — карточка переходит в следующую коробку, срок растёт.
 * «Не помню» — возвращается в первую коробку, повтор завтра.
 */
export function reviewCard(card: StudyCard, remembered: boolean, today: string): StudyCard {
  if (!remembered) {
    return { ...card, box: 0, due: addDays(today, BOX_INTERVALS_DAYS[0]) };
  }
  const box = Math.min(BOX_INTERVALS_DAYS.length - 1, card.box + 1);
  return { ...card, box, due: addDays(today, BOX_INTERVALS_DAYS[box]!) };
}

/** Карточки, которые пора повторить сегодня (срок наступил). */
export function dueCards(cards: readonly StudyCard[], today: string): StudyCard[] {
  return cards.filter((c) => c.due <= today).sort((a, b) => a.due.localeCompare(b.due));
}

export { BOX_INTERVALS_DAYS };
