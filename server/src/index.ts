import { openDb } from "./db.ts";
import { buildApp } from "./app.ts";

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

const app = buildApp(db, { corsOrigin: process.env.CORS_ORIGIN, ...(vapid ? { vapid } : {}) });

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
