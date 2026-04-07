# wr-api

Public Wild Rift API used by `wildriftallstats.ru`.

## Version

- Current version: `1.2.1`
- Release branch format: `release/x.y.z`
- Stable tag format: `v1.2.1`

## Commands

```bash
npm run dev
npm run start
npm run test
npm run setup:admin
npm run import:champions
npm run import:skins
npm run import:riftgg-cn-stats
npm run setup:guides
npm run setup:riftgg-cn-stats
npm run setup:news
```

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
- `GET /api/news`
- `GET /api/news/:id`
- `POST /api/news/import`
- `GET /api/skins`
- `GET /api/skins/:slug`
- `GET /api/health`

Static asset endpoints served by the API:

- `GET /icons/:slug`
- `GET /assets/:key`
- `GET /hero-media/:slug.mp4`

## Asset delivery contract

- Production champion icons are expected to resolve to public S3 URLs when `ASSET_PUBLIC_MODE=s3` and `S3_PUBLIC_BASE_URL` is configured
- Client-facing champion icon payloads should not rely on donor-host URLs or `/wr-api/icons/:slug?src=...` in production
- `/icons/:slug` remains as a runtime mirror/local-cache fallback and for non-S3 environments
- Remaining legacy fallback cleanup work is tracked in [../TECHDEBT.md](/d:/wildRiftChampions/TECHDEBT.md)

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

Setup:

1. Copy [wr-api/.env.example](/d:/wildRiftChampions/wr-api/.env.example) to your local `.env`
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
6. Check `GET /api/guides`, `GET /api/news`, and `GET /api/skins`
7. Push the release branch as `release/x.y.z`
8. Push the stable tag as `vx.y.z`

## Deploy

Deploys to Timeweb run from GitHub Actions on pushes to `main`.

- `.github/workflows/deploy-timeweb.yml` builds a fresh release in `/var/www/wr-api/releases/<timestamp>`
- schema setup runs before the new release is started
- a canary instance is checked on `127.0.0.1:3101`
- after a healthy canary the workflow replaces the live PM2 process on `127.0.0.1:3001`

## Scheduled jobs

- `.github/workflows/update-champions.yml` refreshes champion stats
- `.github/workflows/update-riftgg-cn-stats.yml` imports daily RiftGG CN data

