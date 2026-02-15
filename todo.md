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
