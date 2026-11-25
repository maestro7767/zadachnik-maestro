/**
 * Магазин «Маэстро»: темы оформления и аватарки за монеты.
 * Монеты не гриндятся отдельно — это заработанный опыт минус траты (p.spent),
 * поэтому кошелёк одинаков на всех устройствах без каких-либо событий и счётчиков.
 */

export interface ShopItem {
  readonly id: string;
  readonly kind: "avatar" | "accent" | "background";
  readonly name: string;
  /** Цена в монетах (1 монета = 1 XP). */
  readonly price: number;
  /** Эмодзи аватарки, css-цвет акцента или ключ фона из BACKGROUND_STYLES. */
  readonly value: string;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  // Аватарки-персонажи.
  { id: "av-fox", kind: "avatar", name: "Лиса", price: 30, value: "🦊" },
  { id: "av-panda", kind: "avatar", name: "Панда", price: 30, value: "🐼" },
  { id: "av-frog", kind: "avatar", name: "Лягушка", price: 40, value: "🐸" },
  { id: "av-owl", kind: "avatar", name: "Сова", price: 50, value: "🦉" },
  { id: "av-tiger", kind: "avatar", name: "Тигр", price: 60, value: "🐯" },
  { id: "av-octopus", kind: "avatar", name: "Осьминог", price: 80, value: "🐙" },
  { id: "av-unicorn", kind: "avatar", name: "Единорог", price: 80, value: "🦄" },
  { id: "av-robot", kind: "avatar", name: "Робот", price: 100, value: "🤖" },
  { id: "av-alien", kind: "avatar", name: "Инопланетянин", price: 120, value: "👽" },
  { id: "av-dragon", kind: "avatar", name: "Дракон", price: 150, value: "🐲" },
  // Дополнительные акцентные цвета (базовые открываются уровнями бесплатно).
  { id: "ac-graphite", kind: "accent", name: "Графит", price: 40, value: "#8e8e93" },
  { id: "ac-gold", kind: "accent", name: "Золотой", price: 50, value: "#e6b800" },
  { id: "ac-mint", kind: "accent", name: "Мятный", price: 50, value: "#00c7be" },
  { id: "ac-cherry", kind: "accent", name: "Вишнёвый", price: 60, value: "#d70015" },
  // Фоны карточки профиля.
  { id: "bg-aurora", kind: "background", name: "Аврора", price: 70, value: "aurora" },
  { id: "bg-sunset", kind: "background", name: "Закат", price: 70, value: "sunset" },
  { id: "bg-forest", kind: "background", name: "Лес", price: 70, value: "forest" },
];

/** Градиенты покупных фонов карточки профиля. */
export const BACKGROUND_STYLES: Readonly<Record<string, string>> = {
  aurora: "background:linear-gradient(135deg,#5f4bff,#0a84ff 55%,#64d2ff)",
  sunset: "background:linear-gradient(135deg,#ff9f0a,#ff375f 60%,#bf5af2)",
  forest: "background:linear-gradient(135deg,#0f5132,#34c759)",
};

/** Доступные монеты: заработанный опыт минус потраченное. Отрицательным не бывает. */
export function wallet(totalXpEarned: number, spent: number): number {
  return Math.max(0, totalXpEarned - Math.max(0, spent));
}

export function itemById(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((i) => i.id === id);
}

export function isOwned(owned: readonly string[], id: string): boolean {
  return owned.includes(id);
}

/** Купить можно один раз и только при полном кошельке. */
export function canBuy(item: ShopItem, owned: readonly string[], walletCoins: number): boolean {
  return !isOwned(owned, item.id) && walletCoins >= item.price;
}
