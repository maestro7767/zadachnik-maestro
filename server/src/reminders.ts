import type { Db } from "./db.ts";
import type { PushSend } from "./push.ts";
import { sendToUser } from "./push.ts";

/** План, по которому пора отправить пуш. */
export interface DueReminder {
  readonly userId: string;
  readonly planId: string;
  readonly text: string;
  readonly time: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Локальные дата/время пользователя: utc минус смещение (getTimezoneOffset, минуты). */
function localParts(nowUtcMs: number, tzOffsetMin: number): { date: string; hm: string } {
  const d = new Date(nowUtcMs - tzOffsetMin * 60_000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

interface SubRow {
  user_id: string;
  tz_offset: number | null;
}

interface PlanRow {
  id: string;
  payload: string;
}

/**
 * Находит планы, о которых пора напомнить: невыполненные, с временем, уже наступившим
 * сегодня по локальному времени пользователя, и ещё не напоминанные.
 * Часовой пояс берём из подписки на пуши (клиент шлёт getTimezoneOffset при подписке).
 */
export function findDueReminders(db: Db, nowUtcMs: number): DueReminder[] {
  // У пользователя может быть несколько устройств; зона обычно одна — берём любую известную.
  const tzByUser = new Map<string, number>();
  for (const row of db.prepare("SELECT user_id, tz_offset FROM push_subscriptions").all() as unknown as SubRow[]) {
    if (!tzByUser.has(row.user_id)) tzByUser.set(row.user_id, row.tz_offset ?? 0);
  }
  const out: DueReminder[] = [];
  for (const [userId, tz] of tzByUser) {
    const now = localParts(nowUtcMs, tz);
    const rows = db
      .prepare("SELECT id, payload FROM entities WHERE user_id = ? AND coll = 'plans' AND deleted_at IS NULL")
      .all(userId) as unknown as PlanRow[];
    for (const row of rows) {
      let plan: Record<string, unknown>;
      try {
        plan = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (plan.done === true) continue;
      if (typeof plan.date !== "string" || plan.date !== now.date) continue;
      if (typeof plan.time !== "string" || plan.time === "" || plan.time > now.hm) continue;
      const reminded = db
        .prepare("SELECT 1 FROM reminded WHERE user_id = ? AND plan_id = ?")
        .get(userId, row.id);
      if (reminded) continue;
      out.push({ userId, planId: row.id, text: typeof plan.text === "string" ? plan.text : "План", time: plan.time });
    }
  }
  return out;
}

/**
 * Один проход напоминаний: шлёт пуши и записывает факт отправки,
 * чтобы следующий проход не продублировал.
 */
export async function runReminderPass(
  db: Db,
  send: PushSend,
  nowUtcMs: number,
): Promise<{ plans: number; sent: number; failed: number }> {
  const due = findDueReminders(db, nowUtcMs);
  let sent = 0;
  let failed = 0;
  const mark = db.prepare("INSERT OR IGNORE INTO reminded (user_id, plan_id, fired_at) VALUES (?, ?, ?)");
  for (const r of due) {
    const payload = JSON.stringify({ title: "Задачник Маэстро", body: `${r.text} · ${r.time}`, url: "./" });
    const res = await sendToUser(db, send, r.userId, payload);
    sent += res.sent;
    failed += res.failed;
    if (res.sent > 0) mark.run(r.userId, r.planId, new Date(nowUtcMs).toISOString());
  }
  return { plans: due.length, sent, failed };
}
