# Бэкенд «Маэстро»

Приоритет 2 ТЗ: сервер с базой данных, вход по email, синхронизация между устройствами.

## Стек

- **Fastify 5** — HTTP-сервер.
- **SQLite через `node:sqlite`** (Node 24+): без нативных зависимостей, файл БД рядом с сервером, WAL-режим.
- **argon2id** — хеширование паролей (параметры по рекомендации OWASP: 19 МБ памяти, 2 итерации).
- Тесты — `node:test` через `app.inject`, без поднятия порта.

## Запуск

```bash
cd server
npm install
npm test        # автотесты auth + синхронизации
npm start       # порт из env PORT (по умолчанию 3000), файл БД из env DB_PATH (по умолчанию maestro.db)
```

## API (шаг 2: аккаунты)

| Метод | Путь | Вход | Ответ |
|---|---|---|---|
| POST | `/auth/register` | `{email, password}` | 201 `{userId, accessToken, refreshToken, accessExpiresAt}`; 400 `invalid_email`/`weak_password`; 409 `email_taken`; 429 `rate_limited` |
| POST | `/auth/login` | `{email, password}` | 200 то же; 401 `invalid_credentials` |
| POST | `/auth/refresh` | `{refreshToken}` | 200 новая пара; 401 `invalid_token` |
| POST | `/auth/logout` | `{refreshToken}` | 200 `{ok: true}` |
| GET | `/me` | заголовок `Authorization: Bearer <access>` | 200 `{userId, email}`; 401 `unauthorized` |

## API (шаг 3: синхронизация)

Оба маршрута требуют `Authorization: Bearer <access>` и работают только с данными своего пользователя.

| Метод | Путь | Вход | Ответ |
|---|---|---|---|
| GET | `/sync/pull` | query `since=<ISO>` (необязательно) | 200 `{now, changes[]}`; 400 `invalid_since` |
| POST | `/sync/push` | `{changes[]}` (до 500) | 200 `{now, results[]}`; 400 `invalid_input`/`too_many_changes` |

**Модель**: одна таблица `entities (user_id, coll, id, payload JSON, updated_at, deleted_at)`. Коллекции: `plans`, `habits`, `workouts`, `subjects`, `assessments`, `lessons`, `deadlines`, `cards` + синглтоны `notes`, `profile`, `study_meta` (с фиксированным id `main`).

**Изменение**: `{coll, id, payload, updatedAt, deletedAt}`. `payload` — JSON-объект сущности (до 100 КБ), у удалённых — `null` + `deletedAt` (tombstone, чтобы удаление доехало до других устройств).

**Конфликты — LWW** (last write wins): изменение применяется, только если его `updatedAt` новее хранимого; старое или равное — `skipped_stale` (повторная отправка идемпотентна). Все метки нормализуются к ISO UTC, поэтому сравнение корректно при любом смещении часового пояса.

**pull**: без `since` — полная выгрузка (первый вход на новом устройстве), с `since` — только изменения после метки, включая tombstones. В ответе всегда `now` — серверное время, его клиент сохраняет как следующую метку.

**push**: каждое изменение проверяется отдельно — невалидные получают `status: "rejected"` с кодом ошибки (`unknown_collection`, `invalid_id`, `invalid_updated_at`, `invalid_payload`, `payload_too_large`), валидные применяются. Частичный успех — норма.

## Решения по безопасности

- **Пароли**: только argon2id-хеш, никогда в открытом виде; длина 8–128 символов.
- **Токены**: непрозрачные случайные строки; в базе лежит только SHA-256 от токена — утечка БД не раскрывает токены. Access живёт 15 минут, refresh — 30 дней; при продлении refresh ротируется (старый сгорает). Logout отзывает refresh.
- **Защита от перебора**: rate limit 10 попыток входа/регистрации с IP за 10 минут; на несуществующий email тратится столько же времени (проверка по хешу-заглушке), а ответ одинаковый — нельзя узнать, занят ли адрес.
- **Минимум данных** (ТЗ про подростков): единственное обязательное поле — email. Имена, возраст и аналитика не собираются.
- Email приводится к нижнему регистру; подтверждение адреса письмом — отдельным шагом позже.

## Что дальше

- Шаг 4: клиентский движок синхронизации (outbox-очередь, backoff, индикатор статуса) и экран входа по email.
- Шаг 5: деплой на хостинг, HTTPS, бэкапы БД.
