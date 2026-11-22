import { addDays, parseYmd, pad, ymd } from "../core/date.ts";

/** Результат разбора фразы помощника. */
export interface ParsedWhen {
  /** Текст задачи без слов про дату и время. */
  readonly text: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** HH:MM или пустая строка. */
  readonly time: string;
}

/**
 * Регулярка, которая ищет слово целиком: перед ним пробел или начало строки,
 * после него пробел, знак препинания или конец строки.
 * Нужна, потому что \b в JavaScript не работает с кириллицей.
 */
const rx = (p: string): RegExp => new RegExp("(^|\\s)(" + p + ")(?=[\\s.,!?]|$)");

const WEEKDAYS: Readonly<Record<string, number>> = {
  воскресенье: 0,
  понедельник: 1,
  вторник: 2,
  среда: 3,
  среду: 3,
  четверг: 4,
  пятница: 5,
  пятницу: 5,
  суббота: 6,
  субботу: 6,
};

const MONTHS: Readonly<Record<string, number>> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

/**
 * Разбирает фразу вида «сдать эссе завтра в 18:00» относительно даты today (YYYY-MM-DD).
 * Чистая функция: все даты считаются от переданного today, поэтому её легко тестировать.
 *
 * Понимает: сегодня, завтра, послезавтра, дни недели (в пятницу, в следующий понедельник),
 * даты (15 ноября, 15.11), время (18:00, в 18, в 7 утра/вечера, полдень, полночь).
 * Если дата не указана, берётся today; если время не указано, пустая строка.
 */
export function parseWhen(src: string, today: string): ParsedWhen {
  let s = " " + src.toLowerCase() + " ";
  let date = today;
  let time = "";
  let hadRelative = false;
  let m: RegExpMatchArray | null;
  const cut = (match: RegExpMatchArray): void => {
    s = s.replace(match[0], " ");
  };

  // Относительные даты.
  if ((m = s.match(rx("послезавтра")))) {
    date = addDays(today, 2);
    hadRelative = true;
    cut(m);
  } else if ((m = s.match(rx("завтра")))) {
    date = addDays(today, 1);
    hadRelative = true;
    cut(m);
  } else if ((m = s.match(rx("сегодня")))) {
    hadRelative = true;
    cut(m);
  }

  // День недели: ближайший такой день в будущем (если совпадает с сегодня, то через неделю).
  if (!hadRelative) {
    const dayNames = Object.keys(WEEKDAYS).join("|");
    m = s.match(rx(`(?:в\\s+)?(?:следующ\\w*\\s+)?(${dayNames})`));
    if (m) {
      const target = WEEKDAYS[m[2]!.split(" ").pop()!] as number;
      const current = parseYmd(today).getDay();
      let diff = (target - current + 7) % 7;
      if (diff === 0) diff = 7;
      date = addDays(today, diff);
      cut(m);
    }
  }

  // Явная дата: «15 ноября» или «15.11».
  const monthNames = Object.keys(MONTHS).join("|");
  let day: number | null = null;
  let month: number | null = null;
  if ((m = s.match(rx(`(\\d{1,2})\\s+(${monthNames})`)))) {
    const t = m[2]!.match(/(\d{1,2})\s+(\S+)/)!;
    day = Number(t[1]);
    month = MONTHS[t[2]!] as number;
    cut(m);
  } else if ((m = s.match(rx("(\\d{1,2})[./](\\d{1,2})")))) {
    const t = m[2]!.match(/(\d{1,2})[./](\d{1,2})/)!;
    day = Number(t[1]);
    month = Number(t[2]) - 1;
    cut(m);
  }
  if (day !== null && month !== null) {
    const base = parseYmd(today);
    const d = new Date(base.getFullYear(), month, day);
    if (d < base) d.setFullYear(base.getFullYear() + 1);
    date = ymd(d);
  }

  // Время.
  if ((m = s.match(rx("(?:в\\s+)?полдень")))) {
    time = "12:00";
    cut(m);
  } else if ((m = s.match(rx("(?:в\\s+)?полночь")))) {
    time = "00:00";
    cut(m);
  } else if ((m = s.match(rx("(?:в\\s+)?\\d{1,2}[:.]\\d{2}")))) {
    const t = m[2]!.match(/(\d{1,2})[:.](\d{2})/)!;
    time = `${pad(Number(t[1]))}:${t[2]}`;
    cut(m);
  } else if ((m = s.match(rx("(?:в\\s+)?\\d{1,2}\\s+(утра|вечера|дня|ночи)")))) {
    const t = m[2]!.match(/(\d{1,2})\s+(\S+)/)!;
    let h = Number(t[1]);
    const period = t[2];
    if ((period === "вечера" || period === "дня") && h < 12) h += 12;
    if ((period === "утра" || period === "ночи") && h === 12) h = 0;
    time = `${pad(h)}:00`;
    cut(m);
  } else if ((m = s.match(rx("в\\s+\\d{1,2}")))) {
    time = `${pad(Number(m[2]!.match(/\d{1,2}/)![0]))}:00`;
    cut(m);
  }

  let text = s.replace(/\s+/g, " ").trim().replace(/(^|\s)(в|на)$/, "").trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return { text, date, time };
}
