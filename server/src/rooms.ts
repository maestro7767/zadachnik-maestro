import { randomUUID } from "node:crypto";
import type { Db } from "./db.ts";

/** Совместные комнаты: общие списки задач с приглашением по коду. */

export interface RoomListItem {
  readonly id: string;
  readonly name: string;
  readonly role: "owner" | "member";
  readonly members: number;
  readonly weeklyGoal: number;
  readonly weekDone: number;
}

export interface RoomDetail {
  readonly id: string;
  readonly name: string;
  readonly inviteCode: string;
  readonly myRole: "owner" | "member";
  readonly myId: string;
  readonly weeklyGoal: number;
  readonly weekDone: number;
  readonly members: { id: string; name: string; email: string; role: string }[];
}

export interface RoomTask {
  readonly id: string;
  readonly text: string;
  readonly date: string;
  readonly createdBy: string;
  readonly doneBy: string | null;
  readonly doneAt: string | null;
}

// Человекочитаемый алфавит: без 0/O, 1/I, чтобы код не путался при вводе с телефона.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function inviteCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

/** Понедельник текущей недели (UTC) — рамка недельного челленджа. */
function weekStart(nowIso: string): string {
  const d = new Date(nowIso);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function weekDoneCount(db: Db, roomId: string, nowIso: string): number {
  const start = weekStart(nowIso);
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM room_tasks WHERE room_id = ? AND done_at IS NOT NULL AND done_at >= ?")
    .get(roomId, `${start}T00:00:00.000Z`) as { n: number };
  return row.n;
}

export function createRoom(db: Db, userId: string, name: string, nowIso: string): RoomListItem & { inviteCode: string } {
  const id = randomUUID();
  let code = inviteCode();
  // Код короткий — коллизии редки, но возможны; пробуем до 5 раз.
  for (let i = 0; i < 5 && db.prepare("SELECT 1 FROM rooms WHERE invite_code = ?").get(code); i++) code = inviteCode();
  db.prepare("INSERT INTO rooms (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(id, name, code, userId, nowIso);
  db.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, userId, nowIso);
  return { id, name, role: "owner", members: 1, weeklyGoal: 10, weekDone: 0, inviteCode: code };
}

export type JoinResult = { ok: true; roomId: string } | { ok: false; error: "not_found" | "already_member" };

export function joinRoom(db: Db, userId: string, code: string, nowIso: string): JoinResult {
  const room = db.prepare("SELECT id FROM rooms WHERE invite_code = ?").get(code.trim().toUpperCase()) as { id: string } | undefined;
  if (!room) return { ok: false, error: "not_found" };
  const member = db.prepare("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?").get(room.id, userId);
  if (member) return { ok: false, error: "already_member" };
  db.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(room.id, userId, nowIso);
  return { ok: true, roomId: room.id };
}

export function roleOf(db: Db, roomId: string, userId: string): "owner" | "member" | null {
  const row = db.prepare("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?").get(roomId, userId) as
    | { role: "owner" | "member" }
    | undefined;
  return row ? row.role : null;
}

export function listRooms(db: Db, userId: string, nowIso: string): RoomListItem[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.weekly_goal, m.role,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS members
       FROM rooms r JOIN room_members m ON m.room_id = r.id
       WHERE m.user_id = ? ORDER BY r.created_at DESC`,
    )
    .all(userId) as unknown as { id: string; name: string; weekly_goal: number; role: "owner" | "member"; members: number }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    members: r.members,
    weeklyGoal: r.weekly_goal,
    weekDone: weekDoneCount(db, r.id, nowIso),
  }));
}

export function roomDetail(db: Db, roomId: string, userId: string, nowIso: string): RoomDetail | null {
  const role = roleOf(db, roomId, userId);
  if (!role) return null;
  const room = db.prepare("SELECT name, invite_code, weekly_goal FROM rooms WHERE id = ?").get(roomId) as
    | { name: string; invite_code: string; weekly_goal: number }
    | undefined;
  if (!room) return null;
  const members = db
    .prepare(
      `SELECT u.id, u.name, u.email, m.role FROM room_members m JOIN users u ON u.id = m.user_id
       WHERE m.room_id = ? ORDER BY m.joined_at`,
    )
    .all(roomId) as unknown as { id: string; name: string; email: string; role: string }[];
  return {
    id: roomId,
    name: room.name,
    inviteCode: room.invite_code,
    myRole: role,
    myId: userId,
    weeklyGoal: room.weekly_goal,
    weekDone: weekDoneCount(db, roomId, nowIso),
    members,
  };
}

export function listTasks(db: Db, roomId: string): RoomTask[] {
  const rows = db
    .prepare("SELECT id, text, date, created_by, done_by, done_at FROM room_tasks WHERE room_id = ? ORDER BY done_at IS NOT NULL, date, created_at")
    .all(roomId) as unknown as { id: string; text: string; date: string; created_by: string; done_by: string | null; done_at: string | null }[];
  return rows.map((r) => ({ id: r.id, text: r.text, date: r.date, createdBy: r.created_by, doneBy: r.done_by, doneAt: r.done_at }));
}

export function addTask(db: Db, roomId: string, userId: string, text: string, date: string, nowIso: string): RoomTask {
  const id = randomUUID();
  db.prepare("INSERT INTO room_tasks (id, room_id, text, date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, roomId, text, date, userId, nowIso,
  );
  return { id, text, date, createdBy: userId, doneBy: null, doneAt: null };
}

/** Переключить выполнение. Возвращает null, если задачи нет в этой комнате. */
export function toggleTask(db: Db, roomId: string, taskId: string, userId: string, nowIso: string): RoomTask | null {
  const row = db.prepare("SELECT done_by, done_at FROM room_tasks WHERE id = ? AND room_id = ?").get(taskId, roomId) as
    | { done_by: string | null; done_at: string | null }
    | undefined;
  if (!row) return null;
  if (row.done_at) {
    db.prepare("UPDATE room_tasks SET done_by = NULL, done_at = NULL WHERE id = ?").run(taskId);
  } else {
    db.prepare("UPDATE room_tasks SET done_by = ?, done_at = ? WHERE id = ?").run(userId, nowIso, taskId);
  }
  const t = db.prepare("SELECT id, text, date, created_by, done_by, done_at FROM room_tasks WHERE id = ?").get(taskId) as {
    id: string; text: string; date: string; created_by: string; done_by: string | null; done_at: string | null;
  };
  return { id: t.id, text: t.text, date: t.date, createdBy: t.created_by, doneBy: t.done_by, doneAt: t.done_at };
}

/** Удалить задачу может её автор или владелец комнаты. */
export function deleteTask(db: Db, roomId: string, taskId: string, userId: string, role: "owner" | "member"): boolean {
  const row = db.prepare("SELECT created_by FROM room_tasks WHERE id = ? AND room_id = ?").get(taskId, roomId) as
    | { created_by: string }
    | undefined;
  if (!row) return false;
  if (role !== "owner" && row.created_by !== userId) return false;
  db.prepare("DELETE FROM room_tasks WHERE id = ?").run(taskId);
  return true;
}

export function deleteRoom(db: Db, roomId: string): void {
  db.prepare("DELETE FROM room_tasks WHERE room_id = ?").run(roomId);
  db.prepare("DELETE FROM room_members WHERE room_id = ?").run(roomId);
  db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
}

export function leaveRoom(db: Db, roomId: string, userId: string): void {
  db.prepare("DELETE FROM room_members WHERE room_id = ? AND user_id = ?").run(roomId, userId);
}

export function setWeeklyGoal(db: Db, roomId: string, goal: number): void {
  db.prepare("UPDATE rooms SET weekly_goal = ? WHERE id = ?").run(goal, roomId);
}
