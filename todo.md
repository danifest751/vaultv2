# Ход работ

## 2026-02-15 — Аудит репозитория

### Подзадачи
- [x] Собрать структуру репозитория и список пакетов
- [x] Проверить реализованные подсистемы в packages/*
- [x] Сопоставить реализацию с дорожной картой ТЗ

### Выводы
- Реализованы базовые доменные события и типы (core).
- Реализованы WAL, снапшоты и доменное состояние (storage).
- Реализованы job engine/store и пайплайн scan → ingest → metadata → dedup (jobs).
- Реализованы hash/sha256, content-addressed storage и exact dedup.
- Реализован probabilistic dedup через quarantine, но без UI.
- Отсутствуют apps/server и apps/web, а также UI и runtime интеграция.
- Этап 1 по DoD не закрыт (нет server health endpoint и приложений).
- Этапы 2–4 реализованы на уровне библиотек.
- Этап 5 выполнен частично (только базовое определение метаданных, без exif/ffprobe и derived).
- Этап 6 выполнен частично (quarantine логика без UI и workflows).

### Дополнительные наблюдения
- В репозитории есть тесты для storage/jobs, запускаются через vitest.
- Подключена композитная сборка TypeScript, но приложений нет.
- Пакеты media/faces и слой API отсутствуют, поэтому функциональность ограничена библиотеками.

### Текущий этап по факту
- Проект находится между этапами 2–4 по дорожной карте: база хранения и jobs реализованы, API/UI отсутствуют.

### Ближайший разрыв до DoD
- Этап 1: нужно завести apps/server с health endpoint и проверить build/test.
- Этап 5: требуется полноценный metadata/derived пайплайн и viewer/UI.

## 2026-02-15 — Минимальный сервер

### Подзадачи
- [x] Добавить apps/server с health endpoint
- [x] Включить server в tsconfig references
- [x] Настроить paths для workspace пакетов
- [x] Проверить build/test

## 2026-02-15 — API для Sources и jobs

### Подзадачи
- [x] Добавить эндпоинты Sources (CRUD)
- [x] Добавить эндпоинты jobs (scan enqueue + list)
- [x] Проверить build/test

## 2026-02-15 — API для media и entries + персистентность jobs

### Подзадачи
- [x] Восстанавливать JobStore из WAL при старте
- [x] Добавить эндпоинт sources/:id/entries
- [x] Добавить эндпоинты media list/view
- [x] Проверить build/test

## 2026-02-15 — API для Quarantine

### Подзадачи
- [x] Добавить эндпоинты quarantine list/view
- [x] Добавить эндпоинты quarantine accept/reject через jobs
- [x] Проверить build/test

## 2026-02-15 — API для duplicate links и entry status

### Подзадачи
- [x] Добавить эндпоинты duplicate-links list с фильтрами
- [x] Добавить эндпоинты entries list и entry status view
- [x] Проверить build/test

## 2026-02-15 — Отдача оригиналов из Vault

### Подзадачи
- [x] Добавить эндпоинт media/:id/file
- [x] Проверить build/test

## 2026-02-15 — Снапшоты runtime

### Подзадачи
- [x] Добавить эндпоинты snapshots create/pointer
- [x] Проверить build/test

## 2026-02-15 — Минимальный viewer

### Подзадачи
- [x] Добавить HTML viewer на /ui
- [x] Проверить build/test

## 2026-02-15 — Viewer для quarantine и duplicate links

### Подзадачи
- [x] Добавить вкладки для quarantine и duplicate links в /ui
- [x] Проверить build/test

## 2026-02-15 — Действия quarantine

### Подзадачи
- [x] Добавить accept/reject действия в /ui
- [x] Проверить build/test

## 2026-02-15 — Авто‑рефреш quarantine

### Подзадачи
- [x] Добавить авто‑рефреш и отображение jobId
- [x] Проверить build/test

## 2026-02-15 — Управление source из UI

### Подзадачи
- [x] Добавить создание source и запуск scan в /ui
- [x] Проверить build/test

## 2026-02-15 — Выбор папки в UI

### Подзадачи
- [x] Добавить системный диалог выбора папки
- [x] Проверить build/test

## 2026-02-15 — Автосоздание source после выбора папки

### Подзадачи
- [x] Создавать source сразу после выбора папки
- [x] Проверить build/test

## 2026-02-15 — Улучшение UI и обратной связи

### Подзадачи
- [x] Добавить прогресс и состояния загрузки
- [x] Проверить build/test

## 2026-02-15 — Нормализация UI для source и метрик

### Подзадачи
- [x] Перестроить блок управления source
- [x] Добавить метрики по сущностям
- [x] Проверить build/test

## 2026-02-15 — Живое обновление списков во время scan

### Подзадачи
- [x] Опрос jobs и автообновление списка media
- [x] Проверить build/test

## 2026-02-15 — Sources/Media: список, состояние, quick actions

### Подзадачи
- [x] Перестроить UI sources и добавить состояние
- [x] Добавить quick actions и метрики health
- [x] Проверить build/test

## 2026-02-15 — Защита от повреждённого WAL

### Подзадачи
- [x] Автоматически переносить повреждённый WAL и стартовать с чистого
- [x] Проверить build/test

## 2026-02-18 — Handoff: что делать дальше (Dev Console v2)

### Текущий статус
- [x] Dev Console v2 вынесен в `apps/web/src/dev-console/*` и разделён на секции.
- [x] `/ui` на сервере умеет редиректить в web UI через `DEV_CONSOLE_REDIRECT_URL`.
- [x] Прокси web UI на backend сделан настраиваемым через `FMV_API_PROXY_TARGET`.

### Следующие шаги (приоритет)
1. **Вынести orchestration-логику из `DevConsoleApp.tsx` в hooks**
   - создать `apps/web/src/dev-console/hooks/useDevConsoleState.ts`
   - перенести `load*` / `handle*` функции и связанные состояния
   - оставить в `DevConsoleApp` только layout + маршрутизацию секций

2. **Финализировать переход на новый UI по `/ui`**
   - в dev окружении использовать:
     - `DEV_CONSOLE_REDIRECT_URL=http://127.0.0.1:5175/`
     - `FMV_API_PROXY_TARGET=http://127.0.0.1:3003` (или актуальный порт backend)
   - после стабилизации решить судьбу legacy `apps/server/src/ui.ts` (оставить fallback или удалить)

3. **Улучшить UX сообщений/ошибок**
   - сделать scoped-ошибки по секциям вместо одного глобального banner
   - добавить авто-очистку success сообщений и явный сброс старых error

4. **Добавить интеграционные smoke-тесты для Dev Console v2**
   - проверка базовых сценариев: create source, scan, create/update/delete album
   - проверка отказа без токена и восстановления после refresh

### Минимальный чек перед продолжением
- `npm run web:build`
- `npm test -- apps/web/src/__tests__/album-media-utils.test.ts apps/web/src/__tests__/media-view-utils.test.ts apps/web/src/__tests__/duplicate-filter-utils.test.ts apps/web/src/__tests__/job-status-utils.test.ts apps/web/src/__tests__/format-utils.test.ts apps/web/src/__tests__/error-utils.test.ts apps/web/src/__tests__/navigation.test.ts apps/web/src/__tests__/metrics-utils.test.ts apps/web/src/__tests__/media-search-utils.test.ts`
