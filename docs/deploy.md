# Деплой сервера «Маэстро»

Серверу нужны две вещи: HTTPS (хостинг даёт сам) и персистентный диск под SQLite (папка `/data` в контейнере, туда пишется `maestro.db`).

## Вариант 1: Fly.io (рекомендую — бесплатный диск 1–3 ГБ)

1. Установить flyctl: `winget install Fly-io.flyctl` (Windows) или с https://fly.io/docs/flyctl/install/
2. `fly auth login` — откроется браузер, регистрация по GitHub/Google.
3. Из папки `server/`:
   ```bash
   cd server
   fly launch --no-deploy        # подхватит fly.toml; если имя maestro-server занято — попросит другое
   fly volumes create maestro_data --size 1 --region fra
   fly deploy
   ```
4. Проверка: `curl https://<имя-приложения>.fly.dev/healthz` → `{"ok":true}`.

Машина засыпает без трафика (auto_stop) и просыпается за ~1 с на первом запросе — бесплатно.

## Вариант 2: Render (проще кликами, но диск только на платном плане)

1. dashboard.render.com → New → Blueprint → подключить репозиторий `zadachnik-maestro` — подхватится `render.yaml`.
2. На бесплатном плане диска нет: база будет сбрасываться при каждом перезапуске. Для постоянной базы нужен план Starter ($7/мес) — тогда disk из `render.yaml` применится сам.
3. Проверка: `curl https://maestro-server.onrender.com/healthz`.

## После деплоя: привязать клиент

Адрес сервера клиент берёт из константы в `index.html` (`http://localhost:3000` по умолчанию). Два способа указать боевой:

1. **Насовсем**: поменять значение `SERVER_URL` в `index.html` на `https://<имя>.fly.dev` и запушить — сайт на Pages пересоберётся сам.
2. **Быстро проверить без пересборки**: в консоли браузера на сайте выполнить
   `localStorage.setItem("zadachnik-v1-server", "https://<имя>.fly.dev")` и перезагрузить страницу.

## Переменные окружения сервера

| Переменная | По умолчанию | Зачем |
|---|---|---|
| `PORT` | `3000` | Порт (Fly/Render подставляют свой) |
| `DB_PATH` | `maestro.db` | Путь к файлу SQLite; в контейнере `/data/maestro.db` |
| `CORS_ORIGIN` | `*` | Источник для CORS; после стабилизации можно сузить до домена Pages |

## Бэкапы

База — один файл `/data/maestro.db`. Минимум: `fly ssh console -C "cat /data/maestro.db" > backup.db` по расписанию. Нормальный вариант — Litestream (репликация SQLite в S3) — отдельным шагом, когда появятся реальные пользователи.
