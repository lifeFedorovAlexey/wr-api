# Changelog

## 1.2.0 - 2026-04-06

- added zero-downtime API deploys with release directories, canary health checks, rollback support, and schema setup during deploy
- added daily RiftGG CN import flow with historical snapshots, lane fixes, slug aliases, and lighter guide payload endpoints
- expanded guide and asset resolution with legacy slug normalization plus spell and rune asset aliases
- added skins and news schema setup to the deploy pipeline and exposed health checks for safer production validation
- simplified guide import auth around the real `GUIDES_SYNC_SECRET` contract

## 1.1.0 - 2026-03-23

- added guides storage and import endpoints for normalized WildRiftFire content
- shipped guide detail and guide list API support for the frontend
- mirrored champion icons locally for more stable public asset delivery
- removed the legacy quiz API route

