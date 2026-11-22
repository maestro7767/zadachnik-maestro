import type { UserData } from "./model.ts";
import { SCHEMA_VERSION } from "./model.ts";
import { sanitizeUser } from "./storage.ts";

/** Метка формата, по ней проверяем, что файл выгружен этим приложением. */
export const EXPORT_FORMAT = "maestro-export";

/** Структура файла экспорта. Настройки профиля и аватарка не выгружаются. */
export interface ExportFile {
  readonly format: string;
  readonly version: number;
  readonly exportedAt: string;
  readonly account: string;
  readonly data: { readonly notes: UserData["notes"]; readonly plans: UserData["plans"] };
}

export type ImportResult =
  | { readonly ok: true; readonly added: number; readonly skipped: number; readonly notesFilled: boolean }
  | { readonly ok: false; readonly error: string };

/** Собирает JSON-файл экспорта для одного аккаунта. */
export function buildExport(login: string, user: UserData, exportedAt: string): string {
  const payload: ExportFile = {
    format: EXPORT_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt,
    account: login,
    data: { notes: user.notes, plans: user.plans },
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Объединяет данные из файла с локальными.
 * Планы добавляются, если такого id ещё нет: дубликаты пропускаются, существующие не перезаписываются.
 * Заметка берётся из файла, только если локальная пуста.
 * Профиль не меняется.
 */
export function mergeImport(text: string, local: UserData): { result: ImportResult; user: UserData } {
  const fail = (error: string): { result: ImportResult; user: UserData } => ({
    result: { ok: false, error },
    user: local,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("Файл не читается как JSON");
  }
  if (typeof raw !== "object" || raw === null) return fail("Это не файл экспорта задачника");
  const file = raw as Record<string, unknown>;
  if (file.format !== EXPORT_FORMAT) return fail("Это не файл экспорта задачника");
  if (typeof file.version !== "number" || file.version > SCHEMA_VERSION) {
    return fail("Файл создан в более новой версии приложения");
  }

  const incoming = sanitizeUser(file.data);
  const localIds = new Set(local.plans.map((p) => p.id));
  const fresh = incoming.plans.filter((p) => !localIds.has(p.id));
  const notes = {
    study: local.notes.study || incoming.notes.study,
    sport: local.notes.sport || incoming.notes.sport,
  };
  const notesFilled = notes.study !== local.notes.study || notes.sport !== local.notes.sport;

  return {
    result: {
      ok: true,
      added: fresh.length,
      skipped: incoming.plans.length - fresh.length,
      notesFilled,
    },
    user: { ...local, notes, plans: [...local.plans, ...fresh] },
  };
}
