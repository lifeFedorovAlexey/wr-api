# wr-api

Public Wild Rift API used by `wildriftallstats.ru`.

## Version

- Current version: `1.1.0`
- Release branch format: `release/x.y.z`

## Commands

```bash
npm run dev
npm run start
npm run test
npm run import:champions
npm run setup:guides
```

## Main endpoints

- `GET /api/champions`
- `GET /api/champion-history`
- `GET /api/latest-stats-snapshot`
- `GET /api/winrates-snapshot`
- `GET /api/updated-at`
- `GET /api/guides`
- `GET /api/guides/:slug`
- `POST /api/guides/import`

## Guide import auth

`POST /api/guides/import` accepts one of:

- `Authorization: Bearer <GUIDES_SYNC_TOKEN>`
- `x-guides-sync-secret: <GUIDES_SYNC_SECRET>`

## Release checklist

1. Bump `version` in `package.json` and `package-lock.json`
2. Add release notes to `CHANGELOG.md`
3. Run `npm run test`
4. Confirm `.env` still contains the expected `GUIDES_SYNC_SECRET`
5. Verify the service responds on `http://127.0.0.1:3001/api/guides/import`
6. Push the release branch as `release/x.y.z`

## Deploy

Deploys to Timeweb run from GitHub Actions on pushes to `main`.

