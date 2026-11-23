import { openDb } from "./db.ts";
import { buildApp } from "./app.ts";
import { createPushSender } from "./push.ts";
import { runReminderPass } from "./reminders.ts";

/** Точка входа: база в файле (путь из env DB_PATH), порт из env PORT. */
const db = openDb(process.env.DB_PATH ?? "maestro.db");

// VAPID-ключи приходят из env (fly secrets). Без них сервер работает, но пуши выключены.
const vapid =
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? {
        subject: process.env.VAPID_SUBJECT ?? "mailto:admin@maestro-server.fly.dev",
        publicKey: process.env.VAPID_PUBLIC_KEY,
        privateKey: process.env.VAPID_PRIVATE_KEY,
      }
    : undefined;

const pushSend = vapid ? createPushSender(vapid) : undefined;

// LLM для помощника: ключ только на сервере. Без него клиент использует локальную эвристику.
const ai = process.env.AI_API_KEY
  ? {
      apiKey: process.env.AI_API_KEY,
      baseUrl: process.env.AI_BASE_URL ?? "https://api.moonshot.ai/v1",
      model: process.env.AI_MODEL ?? "moonshot-v1-8k",
    }
  : undefined;

const app = buildApp(db, {
  corsOrigin: process.env.CORS_ORIGIN,
  ...(vapid ? { vapid } : {}),
  ...(pushSend ? { pushSend } : {}),
  ...(ai ? { ai } : {}),
});

// Серверные напоминания: раз в минуту ищем планы с наступившим временем и шлём пуши,
// даже когда приложение закрыто.
if (pushSend) {
  const pass = () => runReminderPass(db, pushSend, Date.now()).catch((e) => console.error("reminders:", e));
  setInterval(pass, 60_000).unref();
  void pass();
}

const port = Number(process.env.PORT ?? 3000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => {
    console.log(`Маэстро-сервер слушает порт ${port}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// Хостинги шлют SIGTERM перед остановкой: закрываемся аккуратно, чтобы SQLite дописал WAL.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
