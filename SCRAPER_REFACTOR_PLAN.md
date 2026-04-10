# Scraper Refactor Plan

Этот план фиксирует целевую схему скраперов и статус перехода.
Источник истины по champion pool: `https://wildrift.leagueoflegends.com/ru-ru/champions/`
с временным fallback на `en-us/champions`, если Riot обновил EN раньше RU.

## Правила

- Чемпионов создаёт только Riot-backed catalog.
- `CN`, `RiftGG`, `WildRiftFire` и другие источники не создают champion entity.
- Любой внешний slug сначала маппится в canonical slug.
- Любое отсутствие/расхождение логируется явно.
- `catch` без лога или немой fallback запрещён.
- Старые данные при смене формата не теряем: переносим и верифицируем.

## Целевая последовательность для каждого pipeline

1. `fetch`
2. `parse`
3. `map`
4. `validate`
5. `persist`
6. `report`

## Статус по pipeline

### 1. Champion Catalog Sync

- [x] Riot catalog вынесен в явный merge-слой.
- [x] `ru-ru` используется как база.
- [x] `en-us` временно добирает missing champion slugs при расхождении по количеству.
- [x] `CN` enrich не может создать нового чемпиона.
- [x] champion sync возвращает structured report.
- [x] stale champions удаляются после Riot sync.
- [ ] данные с Riot detail-page пока не используются как отдельный enrich-слой для fallback-полей.
- [ ] persist-слой ещё не вынесен в отдельный модуль.

### 2. RiftGG CN Stats Import

- [x] импорт идёт только по публичному Riot-backed champion pool.
- [x] временные `en-only` Riot champions явно отмечаются в логах.
- [x] старт, план импорта, excluded/missing slugs и итоговый summary логируются явно.
- [x] item source probes ограничены timeout.
- [x] import-plan/report helpers покрыты unit tests.
- [ ] import script всё ещё совмещает fetch/parse/persist в одном файле.
- [ ] structured report пока не вынесен в отдельный shared helper/modular layer.

### 3. WildRiftFire Guide Import

- [x] верхнеуровневый pipeline разрезан на `fetch sources -> parse sources -> enrich -> report`.
- [x] немой `catch` в tooltip enrichment убран, ошибки логируются явно.
- [ ] слишком много эвристик на DOM и fallback-поиска блоков.
- [ ] нет набора fixture-тестов на реальные guide HTML snapshot-ы.
- [ ] нужно вынести Riot detail-page enrich в отдельный слой, а не держать его внутри общего парсера.

### 4. Shared Mapping / Validation Layer

- [x] canonical/source slug layer централизован.
- [ ] нужен единый validation/reporting helper для всех importers.
- [ ] нужен единый structured log format для `source`, `slug`, `reason`, `url`, `step`.

## Ближайшие следующие шаги

- [ ] Вынести Riot detail-page enrich в отдельный reusable scraper layer.
- [ ] Разрезать `import-riftgg-cn-stats.mjs` на fetch/parse/map/persist/report модули.
- [ ] Разрезать `parse-wildriftfire-guide.js` на отдельные шаги и добавить fixture tests.
- [ ] Ввести единый structured importer report для champion sync, RiftGG import и guide import.
- [ ] Добавить миграционный план для старых форматов данных без потери содержимого.
