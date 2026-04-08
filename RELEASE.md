# Release Guide

## Version bump

1. Update `package.json`
2. Mirror the same version in `package-lock.json`
3. Add a new section to `CHANGELOG.md`
4. Create and push `release/x.y.z`
5. Create and push `vx.y.z`

## Checks before release

1. Run `npm run test`
2. Verify local health on `GET /api/health`
3. Confirm `GUIDES_SYNC_SECRET` matches the value used by the frontend workflow
4. Check `GET /api/guides`
5. If schema or import logic changed, run the relevant `setup:*` scripts locally or in staging

## Deploy flow

1. Push the release branch
2. Validate the branch state
3. Merge to `main`
4. Let the deploy workflow build a fresh release, run schema setup, and pass the canary health check on port `3101`
5. Confirm the live service is healthy on `http://127.0.0.1:3001/api/health`

