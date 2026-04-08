# wr-api Process Split Plan

Этот документ фиксирует целевую схему разделения `wr-api` после стабилизации guide-domain.

Цель шага:

- уменьшить blast radius одного live-процесса
- отделить public read API от auth/session поверхности
- убрать import/write-контур из основного public runtime
- не превращать проект в зоопарк микросервисов

## Текущее состояние

Сейчас один процесс `wr-api` на `127.0.0.1:3001` одновременно обслуживает:

- public read API
- admin auth/session
- site user auth/session
- worker/import HTTP endpoints
- runtime asset delivery:
  - `/icons/:slug`
  - `/assets/:key`
  - `/hero-media/:slug.mp4`

Из-за этого:

- любой релиз auth или asset-логики перекатывает весь API
- import/write surface живёт в том же live-процессе, что и public read traffic
- health-check проверяет только “один комбайн”, а не реальные bounded contexts

## Целевая схема

На одном сервере оставляем три execution lane.

### 1. `wr-api-public`

Назначение:

- только public read API
- только runtime asset delivery

Порт:

- live: `127.0.0.1:3001`
- canary: `127.0.0.1:3101`

Маршруты:

- `GET /api/health`
- `GET /api/champions`
- `GET /api/champion-history`
- `GET /api/champion-events`
- `GET /api/guides`
- `GET /api/guides/:slug`
- `GET /api/tierlist`
- `GET /api/tierlist-bulk`
- `GET /api/latest-stats-snapshot`
- `GET /api/winrates-snapshot`
- `GET /api/updated-at`
- `GET /icons/:slug`
- `GET /assets/:key`
- `GET /hero-media/:slug.mp4`

### 2. `wr-api-auth`

Назначение:

- admin/session boundary
- user/session boundary
- Telegram webapp open flow

Порт:

- live: `127.0.0.1:3003`
- canary: `127.0.0.1:3103`

Маршруты:

- `POST /api/admin/session/exchange`
- `GET /api/admin/session`
- `POST /api/admin/logout`
- `GET /api/admin/users`
- `POST /api/user/session/exchange`
- `GET /api/user/session`
- `POST /api/user/logout`
- `GET/POST /api/user/profile`
- `POST /api/webapp-open`

Примечание:

- `site user` flow ещё не завершён как продуктовая зона, но если он уже существует в коде, держать его лучше рядом с auth boundary, а не в public read app

### 3. `wr-api-workers`

Назначение:

- imports
- schema/setup jobs
- periodic background sync

Это не должен быть постоянный public HTTP app.

Форма исполнения:

- GitHub Actions
- одноразовые shell/script runs на release directory

Сюда относятся:

- `scripts/import-champions.mjs`
- `scripts/import-cn-history.mjs`
- `scripts/import-riftgg-cn-stats.mjs`
- `scripts/backfill-guide-hero-media.mjs`
- `scripts/backfill-guide-entity-assets.mjs`
- `scripts/sync-assets-to-s3.mjs`
- `scripts/setup-*.mjs`

HTTP import endpoints как write surface:

- `POST /api/guides/import`
- `POST /api/cron-import-champions`

Целевой статус:

- либо перенос в internal-only app/profile на localhost без внешней публикации
- либо постепенная замена на прямой вызов scripts из CI без public HTTP endpoints

Рекомендуемый итог:

- `guides` sync должен уйти от публично доступных write endpoints к internal execution path

## PM2 целевая схема

Вместо одного app:

- `wr-api-public`
- `wr-api-auth`

Workers не держим в постоянном PM2 runtime по умолчанию.

Пример целевого `ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "wr-api-public",
      script: "./server-public.mjs",
      cwd: "/var/www/wr-api/current",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: "3001",
        HOST: "127.0.0.1",
      },
    },
    {
      name: "wr-api-auth",
      script: "./server-auth.mjs",
      cwd: "/var/www/wr-api/current",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        PORT: "3003",
        HOST: "127.0.0.1",
      },
    },
  ],
};
```

## Deploy pipeline changes

Текущий deploy:

- собирает один release directory
- гоняет schema setup
- стартует один canary на `3101`
- потом заменяет один PM2 app `wr-api`

Целевой deploy:

1. Подготовить release directory как сейчас.
2. Прогнать schema/setup scripts как сейчас.
3. Стартовать canary `wr-api-public` на `3101`.
4. Стартовать canary `wr-api-auth` на `3103`.
5. Проверить health обоих процессов.
6. Переключить `current` symlink.
7. Перезапустить `wr-api-public`.
8. Перезапустить `wr-api-auth`.
9. Проверить live health обоих процессов.
10. При неуспехе откатить оба процесса на предыдущий release.

Что меняется в workflow:

- `deploy-timeweb.yml` больше не пишет один PM2 app `wr-api`
- workflow должен генерировать `ecosystem.config.cjs` с двумя apps
- health-check должен быть двойным:
  - public health
  - auth health

## Reverse proxy / routing

На сервере по-прежнему может оставаться один внешний домен и один reverse proxy.

Нужна только маршрутизация по path:

- public/read + assets -> `127.0.0.1:3001`
- auth/session -> `127.0.0.1:3003`

Если internal write endpoints пока не убраны:

- import/write routes не публиковать наружу без нужды
- либо гонять их только через localhost/internal proxy rules

## Порядок миграции

### Фаза A. Подготовка

- выделить route ownership maps
- сделать `server-public.mjs`
- сделать `server-auth.mjs`
- оставить текущий `server.mjs` как source для постепенного разрезания до момента switch-over

### Фаза B. Параллельный canary

- научить deploy поднимать оба canary-процесса
- не трогать ещё workers/import workflows

### Фаза C. Switch-over

- заменить один PM2 app на два
- обновить reverse proxy routing
- подтвердить, что UI/admin живут через новую схему

### Фаза D. Internalize write surface

- убрать import endpoints из public live surface
- перевести sync/import jobs на internal-only execution path

## Что не делаем на этом шаге

- не делим проект на отдельные git-репозитории
- не уводим на несколько серверов
- не делаем service mesh / queue stack / k8s
- не переносим workers в постоянный всегда-живой PM2 app без необходимости

## Критерий завершения шага

Шаг считается подготовленным, когда:

- route ownership зафиксирован
- PM2 target topology описана
- deploy pipeline delta описана
- порядок миграции определён без немедленной ломки рантайма
