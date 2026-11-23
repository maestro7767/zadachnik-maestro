import { openDb } from "./db.ts";
import { buildApp } from "./app.ts";

/** Точка входа: база в файле (путь из env DB_PATH), порт из env PORT. */
const db = openDb(process.env.DB_PATH ?? "maestro.db");
const app = buildApp(db);

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
