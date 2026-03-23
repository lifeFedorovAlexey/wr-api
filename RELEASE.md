# Release Guide

## Version bump

1. Update `package.json`
2. Mirror the same version in `package-lock.json`
3. Add a new section to `CHANGELOG.md`
4. Create and push `release/x.y.z`

## Checks before release

1. Run `npm run test`
2. Verify the API is healthy in PM2 after deploy
3. Confirm `GUIDES_SYNC_SECRET` matches the value used by the frontend workflow
4. Check `GET /api/guides` and `POST /api/guides/import`

## Deploy flow

1. Push the release branch
2. Validate the branch state
3. Merge to `main`
4. Let the deploy workflow restart `wr-api` on the server

