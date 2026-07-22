# wr-api

Public Wild Rift API used by `wildriftallstats.ru`.

## Version

- Current version: `1.2.3`
- Release branch format: `release/x.y.z`
- Stable tag format: `v1.2.3`

## Commands

```bash
npm run dev
npm run start
npm run start:public
npm run start:auth
npm run start:gateway
npm run test
npm run setup:admin
npm run setup:champion-lore
npm run import:champions
npm run import:champion-lore
npm run import:riftgg-cn-stats
npm run setup:guides
npm run setup:riftgg-cn-stats
npm run setup:news
npm run setup:quizzes
npm run setup:quiz-media-storage
```

## Champion lore import

Champion lore is stored in `champion_lore` and imported from rendered official
Riot Universe pages. Wild Rift-exclusive champions use an official Wild Rift
champion release page when Universe has no biography.
`generation_facts` contains source sentences only; the importer does not use an
LLM or invent summaries.

```bash
npm run setup:champion-lore
npm run import:champion-lore
npm run import:champion-lore -- --slug ahri
npm run import:champion-lore -- --slug lux --force
npm run import:champion-lore -- --dry-run
npm run import:champion-lore -- --concurrency 3
npm run import:champion-lore -- --missing-only
```

The importer uses a headless browser because Riot Universe renders biographies
client-side. It is idempotent: unchanged source hashes are skipped, and a changed
official biography resets `review_status` to `pending` before generated dialogue

## Daily virtual-assistant generation

The production API owns the fresh stats and lore. A trusted home worker fetches
`GET /api/assistant/tasks`, generates responses through local Ollama, and sends
them to `POST /api/assistant/sync`. The UI reads a prepared response from
`GET /api/assistant/responses?champion=lux&lane=mid&rank=masterPlus`.

The worker reuses the existing `GUIDES_SYNC_SECRET`; no additional secret is required.
The home `.env` also needs:

```env
WR_API_ORIGIN=https://your-domain.example/wr-api
GUIDES_SYNC_SECRET=the-same-existing-value-as-on-the-api-server
OLLAMA_ORIGIN=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
```

Manual run: `npm run generate:assistant`. Install the Windows daily task from
PowerShell with `./scripts/install-assistant-scheduler.ps1 -Time "06:30"`.
The task uses fresh server data; it does not scrape statistics on the home PC.
may consume it.

## Main endpoints

- `GET /api/champions`
- `GET /api/champion-events`
- `GET /api/champion-history`
- `GET /api/tierlist`
- `GET /api/tierlist-bulk`
- `GET /api/latest-stats-snapshot`
- `GET /api/winrates-snapshot`
- `GET /api/updated-at`
- `GET /api/guides`
- `GET /api/guides/:slug`
- `POST /api/guides/import`
- `GET /api/quizzes`
- `GET /api/quizzes/:id`
- `POST /api/quizzes/media-upload`
- `GET /api/health`

Static asset endpoints served by the API:

- `GET /icons/:slug`
- `GET /assets/:key`
- `GET /hero-media/:slug.mp4`

## Asset delivery contract

- Production champion icons are expected to resolve to public S3 URLs when `ASSET_PUBLIC_MODE=s3` and `S3_PUBLIC_BASE_URL` is configured
- Client-facing champion icon payloads should not rely on donor-host URLs or `/wr-api/icons/:slug?src=...` in production
- `/icons/:slug` remains as a runtime mirror/local-cache fallback and for non-S3 environments
- Remaining legacy fallback cleanup work is tracked in the workspace [Master Plan](https://github.com/lifeFedorovAlexey/wildriftchampionsData/blob/main/MASTER_PLAN.md) and [Architecture Status](https://github.com/lifeFedorovAlexey/wildriftchampionsData/blob/main/ARCHITECTURE_TASKS.md)

## Guide import auth

`POST /api/guides/import` accepts:

- `x-guides-sync-secret: <GUIDES_SYNC_SECRET>`

## Admin Auth

Admin access now uses a DB-backed role model:

- `admin_users`
- `admin_identities`
- `admin_roles`
- `admin_user_roles`
- `admin_sessions`

Required env:

- `DATABASE_URL`
- `ADMIN_SESSION_SECRET`

Public user-auth env required by the private quiz module:

- `USER_SESSION_SECRET`

The UI must use the same dedicated `USER_SESSION_SECRET` and set
`USER_AUTH_ENABLED=true`. Quiz media uploads also require `S3_ENDPOINT`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and
`S3_PUBLIC_BASE_URL`. The API fails closed with `503` when object storage is not
configured; it does not write quiz media to local public directories. Run
`npm run setup:quiz-media-storage` once per bucket to allow signed browser POST
uploads from `QUIZ_MEDIA_ALLOWED_ORIGINS`. The signed policy enforces the 5 MB
file-size limit in S3.

Chat handoff env:

- `WR_CHAT_SHARED_SECRET` - shared secret with `wr-chat`; required before deploying chat MVP

Current wr-api repo secret inventory:

- `ADMIN_BOOTSTRAP_EMAILS`
- `ADMIN_SESSION_SECRET`
- `ASSET_PUBLIC_MODE`
- `DATABASE_URL`
- `GUIDES_SYNC_SECRET`
- `S3_ACCESS_KEY_ID`
- `S3_BUCKET`
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`
- `S3_PUBLIC_BASE_URL`
- `S3_SECRET_ACCESS_KEY`
- `TIMEWEB_HOST`
- `TIMEWEB_PASSWORD`
- `TIMEWEB_USER`
- `WR_CHAT_SHARED_SECRET`

Bootstrap env for the very first owner only:

- `ADMIN_BOOTSTRAP_EMAILS`

The following env keys exist in code as optional/internal knobs or unfinished work,
but they are not part of the current approved production secret inventory:

- `ADMIN_BOOTSTRAP_TELEGRAM_IDS`
- `ADMIN_BOOTSTRAP_TELEGRAM_USERNAMES`
- `ADMIN_BOOTSTRAP_VK_IDS`
- `CHAMPIONS_SYNC_SECRET`
- `CHAMPIONS_SYNC_TOKEN`
- `NEWS_SYNC_SECRET`
- `NEWS_SYNC_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `USER_SESSION_SECRET`

`WR_CHAT_SHARED_SECRET` is approved for the chat MVP handoff between `wr-api` and `wr-chat`.

Setup:

1. Copy [`.env.example`](./.env.example) to your local `.env`
2. Fill `DATABASE_URL` and `ADMIN_SESSION_SECRET`
3. Add one bootstrap account for the first owner
4. Run `npm run setup:admin`

Where to get values:

- `DATABASE_URL`: your local Postgres connection string
- `ADMIN_SESSION_SECRET`: generate a long random string, for example `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `ADMIN_BOOTSTRAP_EMAILS`: the Google or Yandex email you will use for the first login

## Release checklist

1. Bump `version` in `package.json` and `package-lock.json`
2. Add release notes to `CHANGELOG.md`
3. Run `npm run test`
4. Confirm `.env` still contains the expected `DATABASE_URL`, S3 settings, `ASSET_PUBLIC_MODE=s3`, and `GUIDES_SYNC_SECRET`
5. Verify the service responds on `http://127.0.0.1:3001/api/health`
6. Check `GET /api/guides`
7. Push the release branch as `release/x.y.z`
8. Push the stable tag as `vx.y.z`

## Deploy

Deploys to Timeweb run from GitHub Actions on pushes to `main`.

- `.github/workflows/deploy-timeweb.yml` builds a fresh release in `/var/www/wr-api/releases/<timestamp>`
- schema setup runs before the new release is started
- canary instances are checked on:
  - `127.0.0.1:3101` for the gateway
  - `127.0.0.1:3102` for `wr-api-public`
  - `127.0.0.1:3103` for `wr-api-auth`
- after healthy canaries the workflow replaces three live PM2 apps:
  - `wr-api` on `127.0.0.1:3001`
  - `wr-api-public` on `127.0.0.1:3002`
  - `wr-api-auth` on `127.0.0.1:3003`

## Runtime topology

- `server.mjs` remains the compatibility monolith for local fallback
- `server-public.mjs` serves public read API and runtime assets
- `server-auth.mjs` serves admin/user session boundaries
- `server-gateway.mjs` keeps one external port and proxies requests to internal `public` and `auth` apps

## Scheduled jobs

- `.github/workflows/update-champions.yml` refreshes champion stats
- `.github/workflows/update-riftgg-cn-stats.yml` imports daily RiftGG CN data
