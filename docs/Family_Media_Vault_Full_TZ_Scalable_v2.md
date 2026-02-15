# Family Media Vault (масштабируемый Vault-подход)
## Полное техническое задание (ТЗ) для реализации с помощью ИИ
Версия: 2.0 (Scalable)  
Язык: Русский  
Целевой объём: **1 000 000+** фото/видео, рост до нескольких миллионов  
Окружение: **Один компьютер (home server)**  
GPU: **RTX 4060 Ti 8GB** (локальная обработка лиц/embeddings в фоне)  
Стек: **Node.js + TypeScript (Backend), Vite + React + TS (UI), файловая БД (без SQL/SQLite)**

---

## 0. Принципы проекта (чтобы не развалилось на 1M+)

### 0.1 Single Source of Truth
- **Vault** — единственное каноническое хранилище оригиналов (content-addressed по sha256).
- **Sources** — набор “источников” (папки/экспорты/архивы), которые могут **постоянно дополняться**.
- **Index** — быстрый индекс/снапшоты/инвертированные списки для поиска.
- **Derived** — превью/постеры/кропы лиц/embeddings и прочие производные артефакты (пересоздаваемы).
- **Quarantine** — спорные случаи (near-duplicates/битые файлы), не попадающие в Vault без решения.

### 0.2 Инкрементальность — базовый режим, не “опция”
Система обязана:
- добавлять новые Sources в любой момент;
- пересканировать Sources инкрементально;
- **не пересчитывать всё** при каждом добавлении источников;
- продолжать долгие пайплайны (лица/события/embeddings) после перезапуска с чекпойнта.

### 0.3 Immutable media objects
- Канонический файл в `vault/media/…` **никогда не перезаписывается**.
- Любые изменения — только метаданные, ссылки, события, альбомы, индексы.

### 0.4 Дедуп “не терять данные”
- Exact duplicates (sha256) — автоскип.
- Strong near-duplicates — автоскип.
- Probable/Derivative — **карантин** (ручное решение).

### 0.5 Восстановимость
- WAL + Snapshot — источник истины состояния.
- Индексы должны быть **полностью пересобираемыми** из snapshot (rebuild).

---

## 1. Цели и результаты

### 1.1 Цели
- Собрать разбросанные фото/видео в единый архив без потери оригиналов.
- Удалить дубликаты (точные и близкие) без рискованного авто-удаления.
- Дать быстрый просмотр/поиск/фильтрацию/шэринг.
- Организовать: **лица → события → альбомы**.
- Поддержать рост объёма без деградации.

### 1.2 Измеримые результаты
- Импорт 1M файлов без “пересборки всего” при добавлении новых Sources.
- Поиск (фильтры) в пределах сотен миллисекунд на 1M+ (при нормальном диске).
- Face pipeline и event pipeline работают пакетно и возобновляемо.

---

## 2. Архитектура

### 2.1 Компоненты
1) **Backend Daemon (Node.js + TS)**
- Scanning, ingest pipeline, jobs, WAL/snapshot/index, API, Telegram bot (опционально).

2) **Web UI (Vite + React + TS)**
- Sources, Library, Viewer, Quarantine, People, Events, Albums, Admin.

3) **Файловая БД**
- WAL (append-only), snapshots, indexes (postings lists), derived assets.

### 2.2 Процессы
- Один “главный” backend процесс.
- Внутри него: job runner + отдельные worker-пулы по типу нагрузки:
  - IO-heavy (scan/hash/copy)
  - CPU-heavy (phash/thumbs)
  - GPU-heavy (faces/embeddings)

---

## 3. Структура Vault (обязательная)

```
Vault/
  media/sha256/aa/bb/<hash>                         # канонические оригиналы (immutable)
  derived/
    thumbs/sha256/aa/bb/<hash>_512.jpg
    thumbs/sha256/aa/bb/<hash>_1024.jpg
    posters/sha256/aa/bb/<hash>_poster.jpg
    face_crops/sha256/aa/bb/<hash>_<faceId>.jpg
    embeddings/
      faces/<faceId>.bin
      clip/<mediaId>.bin                            # v1 (семантика)
  db/
    wal/
      000001.jsonl
      000002.jsonl
    snapshots/
      entities_latest.ndjson.zst
      pointer.json
    indexes/
      by_sha256_prefix/
      by_taken_day/
      by_type/
      by_camera/
      by_source/
      by_person/
      by_event/
      by_album/
      by_phash_bucket/
      by_gps_tile/
      text/
        token_dict.bin
        postings/
    meta/
      schema.json
      checkpoints.json
      config.json
    locks/
  quarantine/
    items/<quarantineId>/
      preview_512.jpg
      source_ref.json
      candidates.json
  tmp/
    unpack/<jobId>/
  logs/
```

**Примечание:** `derived/` пересоздаваем. `media/` — единственное, что нельзя потерять.

---

## 4. Источники (Sources) и модель инкрементальности

### 4.1 Source
Поля:
- `sourceId`
- `path`
- `recursive: boolean`
- `includeArchives: boolean`
- `excludeGlobs: string[]`
- `createdAt`

### 4.2 SourceEntry (обнаруженная сущность)
Поля:
- `sourceEntryId`
- `sourceId`
- `kind: "file" | "archive_entry"`
- `path` (для file)
- `archivePath`, `innerPath` (для archive_entry)
- `size`
- `mtime`
- `fingerprint` = `size + mtime + hash(first64KB)`
- `lastSeenAt`
- `state: "active" | "missing" | "deleted"`

### 4.3 Инкрементальный Scan: строгие правила
Скан не должен читать весь файл, если он не изменился.

**Алгоритм:**
1) Обход файловой структуры (или “архивной структуры”).
2) Для каждого entry:
   - вычислить lightweight `fingerprint`:
     - если `size+mtime` не изменились → считать `fingerprint` прежним (без чтения bytes)
     - если изменились → посчитать `first64k_hash`
3) Если `fingerprint` не изменился → пометить `lastSeenAt` и **не ставить ingest job**.
4) Если новый/изменился → поставить ingest job для этого SourceEntry.

### 4.4 Политика удаления/исчезновения
- Если файл исчез из Source: SourceEntry получает `state="missing"` и `lastSeenAt` обновляется.
- **Не удалять** канонический объект из Vault автоматически.
- Опционально: режим “garbage collection” (ручной) для медиа, которое больше не имеет ссылок ни на один SourceEntry.

---

## 5. Ingest Pipeline (масштабируемый)

### 5.1 Пайплайн по стадиям (каждая стадия — job, возобновляемая)
**Stage A: HASH**
- потоково считать sha256
- записать `MEDIA_SHA256_COMPUTED`

**Stage B: EXACT DEDUP (L0)**
- если sha256 уже есть → `MEDIA_SKIPPED_DUPLICATE_EXACT` + создать `DuplicateLink` (ссылка)
- завершить пайплайн для entry

**Stage C: METADATA**
- фото: exiftool
- видео: ffprobe
- нормализация дат
- событие `MEDIA_METADATA_EXTRACTED`

**Stage D: DERIVED**
- thumbs 512/1024
- video poster
- событие `DERIVED_CREATED`

**Stage E: NEAR DEDUP (фото)**
- вычислить pHash/dHash на thumb 512
- candidates из `by_phash_bucket`
- скоринг → L1/L2/L3
- L1: `MEDIA_SKIPPED_DUPLICATE_STRONG` + DuplicateLink
- L2: `QUARANTINE_CREATED`
- L3: сохранить в Vault + `MEDIA_IMPORTED`

**Stage F: INDEX UPDATE**
- обновить postings lists (инкрементально)
- событие `INDEX_UPDATED` (по ключам, не целиком)

### 5.2 Идемпотентность
Каждый job имеет `jobId`. Любое событие WAL включает `jobId` и `sourceEntryId`.
Повтор job:
- если результат уже применён (согласно snapshot/state), job считается done.

### 5.3 Ограничение ресурсов (обязательное)
- IO pool: 1–4 concurrent (зависит от диска)
- CPU pool: 2–6 concurrent (зависит от CPU)
- GPU pool: 1–2 concurrent (4060 Ti 8GB)

Система обязана иметь throttle, чтобы не убить диск/OS.

---

## 6. Дедупликация (точная + близкая + производные)

### 6.1 Уровни
- **L0 Exact:** sha256 совпал → автоскип
- **L1 Strong:** near-duplicate с высокой уверенностью → автоскип
- **L2 Probable/Derivative:** карантин
- **L3 Unique:** импортировать

### 6.2 Признаки для фото
- sha256
- width/height/aspect ratio
- takenAt (+confidence)
- pHash64 + dHash64
- byte-size (как слабый сигнал “сжатия”)

### 6.3 Правила скоринга (конфигурируемые)
Начальные дефолты:
- `PHASH_STRONG <= 4` и `DHASH_STRONG <= 6` → L1
- `PHASH_QUARANTINE <= 10` → L2
- `PHASH_QUARANTINE <= 12` при `timeDelta <= 600s` → L2
- иначе L3

Видео:
- Exact только по sha256 (MVP)
- Near video → только карантин (v1, осторожно)

### 6.4 Карантин (обязателен)
Для каждого L2 сохранять:
- preview 512
- ссылки на sourceEntry
- top-3 кандидата (mediaId + причины)
- статус: pending/accepted(linked/imported)/rejected

Пока pending — объект **не виден** в Library.

---

## 7. Лица (People) — масштабируемый Face Pipeline

### 7.1 Цель
Поиск фото/видео по членам семьи:
- “все фото с X”
- “X в 2019”
- “X + Y”

### 7.2 Требования к пайплайну
- Работает **инкрементально**: обрабатывает только новые/необработанные media.
- Возобновляем: хранит прогресс/чекпойнты.
- Не требует пересчёта всего набора при добавлении Sources.

### 7.3 Стадии
1) Face detection на thumb 512 (или 1024 по настройке)
2) Сохранить crop лица (derived/face_crops)
3) Посчитать embedding (onnx/insightface)
4) Записать face entity (bbox, embedding ref)
5) Пакетная кластеризация (offline job по батчам)

### 7.4 Incremental clustering policy (важно)
На 1M+ нельзя каждый раз кластеризовать все embedding заново.

**Политика:**
- Стабильные “ядра кластеров” (centroids) сохраняются.
- Новые embeddings сначала присваиваются ближайшему centroid (если distance < threshold).
- Иначе — попадают в “unassigned pool”.
- Периодически запускается offline clustering только для unassigned pool + слабых кластеров.

UI позволяет:
- merge/split clusters
- назначить cluster → person

### 7.5 Индексы
- `by_person/<personId>` → postings mediaId
- `faces_by_media/<mediaId>` → список faceId (можно как индекс или как поле)

---

## 8. События (Events) — масштабируемый Event Builder

### 8.1 Цель
Автоматически группировать фото в события и давать их редактировать.

### 8.2 Автосборка событий (MVP алгоритм)
- сортировка по `takenAt` (fallback: createdAtFs)
- разбиение на кластеры по времени:
  - новый cluster, если gap > `EVENT_TIME_GAP` (дефолт 2 часа)
- если есть GPS:
  - дополнительно новый cluster при расстоянии > `EVENT_DISTANCE_GAP` (дефолт 2 км)
- если есть лица:
  - добавить person hints в название (не обязательно)

### 8.3 Инкрементальность событий
Новые медиа не должны вызывать полный rebuild всех событий.

**Политика:**
- Для каждого дня/недели держать “event window index” (например по дням).
- Новые медиа попадают в кандидаты для соседних событий по времени (± 1 день).
- Если не подходит — создаётся новое событие.
- Периодический offline job: “event cleanup” (слияние/разделение) для последних N недель и/или выбранного диапазона.

### 8.4 UI операции
- rename
- merge events
- split event (по времени/ручным отметкам)
- pin cover photo

---

## 9. Альбомы (Albums)

### 9.1 Manual album
- Пользователь вручную добавляет media.

### 9.2 Smart album (правила)
`rulesJson` поддерживает:
- date range
- type
- personId (один/несколько)
- gps tile / bounding box
- eventId
- cameraModel
- tags (ручные)
- favorites flag

Smart albums пересчитываются:
- инкрементально при добавлении media (при возможности)
- либо периодическим job: “smart album refresh”

---

## 10. Поиск и индексация

### 10.1 Обязательные индексы (MVP)
- by_taken_day
- by_type
- by_camera
- by_source
- by_person
- by_event
- by_album
- by_phash_bucket
- by_gps_tile
- by_sha256_prefix

### 10.2 Full-text (v1)
- для: названий событий, тегов, описаний, пользовательских заметок
- инвертированный индекс token → postings mediaId/eventId

### 10.3 Семантический поиск (v1+)
- CLIP embeddings (offline job) + ANN индекс
- API: “найти похожее” / “найти по запросу” (опционально)

---

## 11. Файловая БД: WAL / Snapshot / Index (масштабирование)

### 11.1 WAL
- append-only JSONL
- ротация: 256MB–1GB
- fsync на критических этапах

### 11.2 Snapshot
- сборка snapshot каждые N событий или каждые X минут
- pointer.json указывает snapshot + checkpoint WAL offset

### 11.3 Индексы: стратегия обновления
**Инкрементально:**
- обновлять только нужные ключи (day/type/camera/gps/phash…)

**Compaction policy (обязательная):**
- сегменты индекса + периодическое merge/compaction (pausable)

### 11.4 Rebuild policy
- rebuild индексов из snapshot всегда возможен
- rebuild выполняется батчами (по датам/сегментам)

---

## 12. Производительность и хранение

- SSD: db + derived (желательно)
- HDD: media (желательно)
- scrub job для целостности sha256

---

## 13. API (контракт)
(см. секции Sources/Jobs/Media/Quarantine/People/Events/Albums выше)

---

## 14. UI (страницы)
Dashboard / Sources / Library / Viewer / Quarantine / People / Events / Albums

---

## 15. Безопасность
Локальная авторизация + лимиты + защита архивов; наружу — только через VPN.

---

## 16. Бэкапы
3-2-1, обязательно бэкапить `media/`.

---

## 17. Acceptance Criteria (детализировано)

### 17.1 Инкрементальность Sources
- Добавление нового Source не вызывает повторной обработки неизменённых SourceEntry в других Sources.
- Повторный scan одного Source не создаёт новых ingest jobs для неизменённых файлов.
- Изменение файла (size/mtime) приводит к обновлению fingerprint и постановке ingest job.
- Если файл исчез из Source, SourceEntry получает `state="missing"`, но канонический объект **не удаляется** автоматически.

### 17.2 Exact dedup (L0)
- При импорте двух идентичных файлов создаётся **1** `MediaObject` и **1+** `DuplicateLink(level=exact)`.
- В `Vault/media/` присутствует ровно один канонический файл для данного sha256.
- Повторный импорт того же набора Sources не увеличивает количество файлов в `Vault/media/`.

### 17.3 Near dedup + Quarantine (L1/L2)
- Телеграм‑сжатые/ресайз‑версии чаще всего попадают в L1 (autolink) или L2 (quarantine) в соответствии с порогами.
- L2 элементы **не появляются** в Library до решения в Quarantine Inbox.
- Решение в карантине (import/link/reject) фиксируется в WAL и воспроизводимо после рестарта.
- Для L1/L2 в системе сохраняются причины совпадения (phash/dhash distance, timeDelta, dims signal).

### 17.4 Jobs: идемпотентность и возобновляемость
- Любой job при повторном запуске не создаёт дубликатов данных и не ломает состояние (idempotent по `jobId`).
- После падения процесса jobs продолжаются с чекпойнта (scan/import/faces/events).
- Jobs поддерживают `pause/resume/cancel` через API как минимум для long‑running задач.

### 17.5 Индексы и rebuild
- Индексы могут быть удалены и пересобраны из snapshot без потери медиа/сущностей.
- Rebuild выполняется батчами и не требует загрузки всей базы в RAM.
- После rebuild результаты поиска совпадают с исходными (детерминированность в пределах сортировок/курсорной пагинации).

### 17.6 Faces incremental
- Детекция/embeddings запускаются только для новых/необработанных media.
- Присвоение новых embeddings к существующим centroids не требует глобальной перекластеризации.
- UI позволяет назначать кластеры персонам и отображает медиа по `personId`.

### 17.7 Events incremental
- Добавление новых медиа добавляет их в существующее событие или создаёт новое без полного rebuild.
- Операции merge/split/rename фиксируются в WAL и сохраняются после рестарта.

### 17.8 Производительность (ориентиры)
- Фильтровый поиск по индексам: p95 < 500ms на 1M+ (при SSD под `db/index`).
- Импорт не блокирует UI: тяжёлые операции выполняются через jobs.
- IO throttling предотвращает полную загрузку диска/системы.

---

## 18. План разработки (Roadmap с контрольными точками)

### Этап 1 — Bootstrap (репо + core)
- Монорепо, сборка, тесты
- core типы + конфиг
- server health endpoint

**DoD:** `build/test` проходят, server стартует.

### Этап 2 — Storage foundation (WAL + snapshot)
- WAL append-only + ротация + HMAC chain
- snapshot builder + pointer.json
- API: sources CRUD (минимум)

**DoD:** создание Source сохраняется и восстанавливается после рестарта.

### Этап 3 — Incremental scan
- scan job с чекпойнтами
- fingerprint стратегия
- API: scan enqueue + jobs list

**DoD:** повторный scan не создаёт лишних ingest job.

### Этап 4 — Hash + exact dedup + store
- sha256 streaming
- content-addressed storage
- DuplicateLink exact
- API: media list/view

**DoD:** два одинаковых файла → один объект в Vault.

### Этап 5 — Metadata + derived + viewer
- exiftool/ffprobe
- thumbs/posters
- UI: library + viewer

**DoD:** таймлайн по takenAt, превью стабильны.

### Этап 6 — Near dedup + Quarantine
- phash/dhash + buckets
- L1/L2/L3 решения
- UI: Quarantine Inbox + resolve actions

**DoD:** телеграм‑копии не попадают в Vault, L2 управляется вручную.

### Этап 7 — Faces (incremental)
- detection/crops/embeddings
- incremental assignment + unassigned pool
- UI: People

**DoD:** поиск по человеку работает.

### Этап 8 — Events + Albums
- event builder incremental + UI
- manual + smart albums

**DoD:** события и альбомы участвуют в поиске/фильтрах.

### Этап 9 — Scale hardening
- index segmentation + compaction jobs
- scrub/integrity checks
- backup scripts + recovery drills

**DoD:** устойчивость на 1M+ и восстановление после сбоев.

---

## 19. Конфигурация и операционные режимы

### 19.1 Обязательные параметры
- `VAULT_PATH`
- `WAL_HMAC_SECRET`
- `IO_CONCURRENCY`, `CPU_CONCURRENCY`, `GPU_CONCURRENCY`
- `PHASH_STRONG_THRESHOLD`, `DHASH_STRONG_THRESHOLD`
- `PHASH_QUARANTINE_THRESHOLD`, `TIME_STRONG_WINDOW_SECONDS`, `TIME_QUARANTINE_WINDOW_SECONDS`
- `EVENT_TIME_GAP_SECONDS`, `EVENT_DISTANCE_GAP_METERS`
- `MAX_ARCHIVE_SIZE_BYTES`, `MAX_UNPACK_SIZE_BYTES`

### 19.2 Режимы запуска
- **Normal:** инкрементальная обработка, jobs в фоне.
- **Rebuild indexes:** пересборка индексов из snapshot (без пересчёта media).
- **Scrub mode:** выборочная проверка целостности media по sha256.
- **Maintenance/Compaction:** компакция индексных сегментов, приоритет низкий.

### 19.3 Ротация и обслуживание
- WAL ротация по размеру (256MB–1GB).
- Snapshot сборка по таймеру или по количеству событий.
- Компакция индексов по расписанию (например nightly).

