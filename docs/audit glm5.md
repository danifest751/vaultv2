# Аудит проекта Family Media Vault

**Дата:** 2026-02-18  
**Модель:** GPT-5.2 Codex High  
**Область:** текущая реализация `apps/server`, `packages/core`, `packages/storage`, `packages/jobs`  
**Формат:** технический аудит по ТЗ (масштаб 1M+, инкрементальность, WAL+snapshot, rebuild, дедуп+карантин)

---

## 1) Summary

Проект прошёл значительную эволюцию с предыдущего аудита (2026-02-17). Текущий статус — **beta / почти production-ready**:

- ✅ Закрыты критические проблемы безопасности: обязательный `WAL_HMAC_SECRET`, опциональный auth token, source path allowlist
- ✅ Реализован полный metadata pipeline: exiftool для фото, ffprobe для видео
- ✅ Near-dedup на perceptual hashes (pHash) с настраиваемыми порогами
- ✅ Derived artifacts: thumbs/posters с атомарной генерацией и retry
- ✅ Stage F: posting indexes + `/media/search` с фильтрами, cursor pagination, сортировкой
- ✅ Модульная архитектура server (routes/bootstrap/ui/http-utils)
- ✅ Snapshot retention policy

**Осталось до production:**
- ⚠️ Индексы для масштабного поиска (by_taken_day, by_camera, by_gps_tile, etc.)
- ⚠️ Face pipeline (detection/embeddings/clustering)
- ⚠️ Events auto-grouping
- ⚠️ Albums (manual + smart)
- ⚠️ Full-text search
- ⚠️ Soak-тесты на 100k/1M+ entries

---

## 2) Структура проекта

```
vaultv2/
├── apps/
│   └── server/           # HTTP API + dev UI
│       └── src/
│           ├── bootstrap.ts      # Runtime init, job wiring
│           ├── routes.ts         # HTTP routing (778 lines)
│           ├── http-utils.ts     # readJson/sendJson/sendHtml
│           ├── ui.ts             # Dev console UI (52KB)
│           ├── server-config.ts  # Config loading from env
│           ├── server.ts         # startServer entry
│           ├── snapshot-retention.ts
│           └── __tests__/        # 4 test files
├── packages/
│   ├── core/             # Domain types, IDs, events
│   │   └── src/
│   │       ├── events.ts         # DomainEvent types (202 lines)
│   │       ├── ids.ts            # Branded types
│   │       └── invariants.ts
│   ├── storage/          # WAL, snapshot, state, vault
│   │   └── src/
│   │       ├── state.ts          # DomainState + stores (714 lines)
│   │       ├── wal.ts            # Append-only WAL with HMAC
│   │       ├── snapshot.ts        # Snapshot write/read
│   │       ├── state-snapshot.ts # DomainState ↔ snapshot
│   │       ├── rebuild.ts        # Rebuild from snapshot+WAL
│   │       ├── vault.ts          # Content-addressed storage
│   │       ├── metadata.ts       # Basic metadata extraction
│   │       ├── derived.ts        # Derived paths
│   │       └── __tests__/
│   └── jobs/             # Job handlers
│       └── src/
│           ├── job-engine.ts     # Job runner with concurrency
│           ├── job-store.ts      # Job state management
│           ├── scan.ts           # Incremental scan
│           ├── ingest.ts         # SHA256 + exact dedup
│           ├── metadata.ts       # Exiftool/ffprobe metadata
│           ├── derived.ts        # Thumb/poster generation
│           ├── dedup.ts          # Probable dedup with pHash
│           ├── quarantine.ts     # Quarantine resolution
│           └── __tests__/
├── docs/
│   ├── Family_Media_Vault_Full_TZ_Scalable_v2.md
│   ├── project-audit-2026-02-17.md
│   └── repository-structure.md
├── vitest.config.ts
├── tsconfig.base.json
└── package.json          # Monorepo root
```

---

## 3) Соответствие ТЗ

### 3.1 Принципы (Section 0)

| Принцип | Статус | Комментарий |
|---------|--------|-------------|
| Single Source of Truth (Vault) | ✅ | Content-addressed по sha256 |
| Инкрементальность | ✅ | Scan проверяет fingerprint, не пересканирует неизменённое |
| Immutable media objects | ✅ | Vault media никогда не перезаписывается |
| Dedup "не терять данные" | ✅ | L0 exact, L1 strong, L2 quarantine, L3 unique |
| Восстановимость (WAL+Snapshot) | ✅ | Rebuild из snapshot + WAL tail |

### 3.2 Ingest Pipeline (Section 5)

| Stage | Статус | Реализация |
|-------|--------|------------|
| A: HASH | ✅ | `ingest.ts` — streaming SHA256 |
| B: EXACT DEDUP (L0) | ✅ | `ingest.ts` — проверка sha256, DuplicateLink |
| C: METADATA | ✅ | `metadata.ts` — exiftool/ffprobe, нормализация |
| D: DERIVED | ✅ | `derived.ts` — thumbs/posters, атомарная генерация |
| E: NEAR DEDUP | ✅ | `dedup.ts` — pHash + hamming distance, L1/L2/L3 |
| F: INDEX UPDATE | ✅ | `MediaSearchIndexStore` — posting lists |

### 3.3 Дедупликация (Section 6)

| Уровень | Статус | Реализация |
|---------|--------|------------|
| L0 Exact | ✅ | sha256 match → MEDIA_SKIPPED_DUPLICATE_EXACT |
| L1 Strong | ✅ | pHash distance ≤ 4 → DUPLICATE_LINK_CREATED (level=strong) |
| L2 Probable | ✅ | pHash distance ≤ 10 → QUARANTINE_CREATED |
| L3 Unique | ✅ | Импорт в Vault |

**Настраиваемые пороги:**
- `DEDUP_STRONG_DISTANCE_THRESHOLD` (default: 4)
- `DEDUP_PROBABLE_DISTANCE_THRESHOLD` (default: 10)

### 3.4 Лица (Section 7)

| Компонент | Статус | Комментарий |
|-----------|--------|-------------|
| Face detection | 🔴 | Не реализовано |
| Face crops | 🔴 | Не реализовано |
| Embeddings | 🔴 | Не реализовано |
| Incremental clustering | 🔴 | Не реализовано |
| by_person index | 🔴 | Не реализовано |

### 3.5 События (Section 8)

| Компонент | Статус | Комментарий |
|-----------|--------|-------------|
| Event builder | 🔴 | Не реализовано |
| Incremental events | 🔴 | Не реализовано |
| Merge/split UI | 🔴 | Не реализовано |

### 3.6 Альбомы (Section 9)

| Компонент | Статус | Комментарий |
|-----------|--------|-------------|
| Manual albums | 🔴 | Не реализовано |
| Smart albums | 🔴 | Не реализовано |

### 3.7 Поиск и индексация (Section 10)

| Индекс | Статус | Реализация |
|--------|--------|------------|
| by_sha256_prefix | ✅ | В `MediaStore` |
| by_phash_bucket | ✅ | В `MediaMetadataStore` |
| by_taken_day | 🔴 | Не реализовано |
| by_type | ✅ | `kindIndex` в `MediaSearchIndexStore` |
| by_camera | 🔴 | Не реализовано |
| by_source | ✅ | `sourceIdIndex` в `MediaSearchIndexStore` |
| by_person | 🔴 | Не реализовано |
| by_event | 🔴 | Не реализовано |
| by_album | 🔴 | Не реализовано |
| by_gps_tile | 🔴 | Не реализовано |
| Full-text | 🔴 | Не реализовано |
| Семантический (CLIP) | 🔴 | Не реализовано |

---

## 4) Безопасность

### 4.1 Исправленные проблемы

| Проблема (предыдущий аудит) | Статус | Решение |
|------------------------------|--------|---------|
| Небезопасный дефолт секрета WAL | ✅ | `WAL_HMAC_SECRET` обязателен, fail-fast при отсутствии |
| Нет аутентификации/авторизации | ✅ | Опциональный `AUTH_TOKEN` (Bearer + X-Auth-Token) |
| Не валидируются пути источников | ✅ | `SOURCE_PATH_ALLOWLIST_ROOTS` allowlist |

### 4.2 Текущие риски

| Риск | Уровень | Комментарий |
|------|---------|-------------|
| Нет rate limiting | Medium | Возможно DoS на /media/search |
| Нет encryption at rest | Low | Media файлы не шифруются |
| Asset tokens с коротким TTL | ✅ | 60 секунд, HMAC-signed |

---

## 5) Качество кода

### 5.1 Тесты

```
Test Files  14 passed (14)
Tests       49 passed (49)
Duration    1.95s
```

**Покрытие по модулям:**
- `storage`: WAL, snapshot, rebuild, state-snapshot ✅
- `jobs`: scan-ingest, metadata-derived, dedup-phash, quarantine, job-engine ✅
- `server`: routes, server-config, bootstrap, snapshot-retention ✅

**Типы тестов:**
- Unit: WAL integrity, config normalization, asset tokens
- Integration: scan→ingest→metadata→dedup pipeline
- Regression: idempotency, retry, concurrent generation

### 5.2 Архитектура

**Сильные стороны:**
- Event sourcing с детерминированным rebuild
- Модульный server (routes/bootstrap/ui разделены)
- Type-safe branded IDs (`MediaId`, `SourceId`, etc.)
- Immutable vault с content-addressed storage
- Job engine с concurrency, retry, dedup

**Технический долг:**
- `routes.ts` — 778 строк, можно декомпозировать на sub-routers
- `ui.ts` — 52KB, можно вынести в отдельный UI пакет
- Нет invariants tests для domain logic

---

## 6) API Endpoints

### 6.1 Реализованные

| Endpoint | Method | Описание |
|----------|--------|----------|
| `/health` | GET | Health check |
| `/tools/health` | GET | Tools availability (exiftool/ffprobe/ffmpeg) |
| `/ui` | GET | Dev console UI |
| `/sources` | GET | List sources |
| `/sources` | POST | Create source (с allowlist валидацией) |
| `/sources/:id/scan` | POST | Enqueue scan job |
| `/media` | GET | List media (paginated) |
| `/media/search` | GET | Search with filters + cursor pagination |
| `/media/:id/file` | GET | Media file (с signed token) |
| `/derived/:id/thumb` | GET | Thumbnail |
| `/derived/:id/poster` | GET | Video poster |
| `/jobs` | GET | List jobs |
| `/quarantine` | GET | List quarantine items |
| `/quarantine/:id/accept` | POST | Accept quarantine |
| `/quarantine/:id/reject` | POST | Reject quarantine |
| `/snapshots` | POST | Create snapshot |
| `/snapshots` | GET | List snapshots |

### 6.2 Media Search

**Фильтры:**
- `kind` — photo/video/unknown
- `mimeType` — normalized MIME type
- `sourceId` — Source ID
- `duplicateLevel` — exact/strong/probable

**Сортировка:**
- `mediaId_asc` (default)
- `takenAt_desc`

**Пагинация:**
- `limit` — page size
- `offset` — offset pagination
- `cursor` — cursor pagination (nextCursor в ответе)

**Валидация:**
- Минимум один фильтр обязателен
- Invalid filters → 400
- cursor + offset conflict → 400

---

## 7) Конфигурация

### 7.1 Обязательные переменные

| Переменная | Описание |
|------------|----------|
| `WAL_HMAC_SECRET` | HMAC secret для WAL integrity (обязательно) |

### 7.2 Опциональные переменные

| Переменная | Default | Описание |
|------------|---------|----------|
| `PORT` | 3000 | Server port |
| `DATA_DIR` | `./data` | Base data directory |
| `AUTH_TOKEN` | "" | Auth token (пусто = без auth) |
| `SOURCE_PATH_ALLOWLIST_ROOTS` | "" | Allowed source path roots |
| `DERIVED_GENERATE_MAX_ATTEMPTS` | 2 | Retry attempts for derived |
| `DEDUP_STRONG_DISTANCE_THRESHOLD` | 4 | pHash strong threshold |
| `DEDUP_PROBABLE_DISTANCE_THRESHOLD` | 10 | pHash quarantine threshold |
| `SNAPSHOT_RETENTION_MAX` | 20 | Max snapshots to keep |

---

## 8) Roadmap до production

### Фаза 1: Scale Hardening (2–3 недели)

1. **Индексы для 1M+**
   - `by_taken_day` — для timeline
   - `by_camera` — для фильтрации
   - `by_gps_tile` — для гео-поиска
   - Сегментация индексов + compaction

2. **Soak-тесты**
   - Генерация 100k/1M synthetic entries
   - Замер RAM, rebuild time, search latency
   - Профилирование hot paths

3. **Оптимизации**
   - Cursor pagination O(log n) вместо O(n)
   - Lazy loading metadata
   - Batched index updates

### Фаза 2: Faces (3–4 недели)

1. Face detection (ONNX/InsightFace)
2. Face crops + embeddings
3. Incremental clustering
4. `by_person` index
5. UI: People page

### Фаза 3: Events + Albums (2–3 недели)

1. Event auto-builder (time + GPS clustering)
2. Incremental event updates
3. Manual albums CRUD
4. Smart albums rules engine
5. UI: Events/Albums pages

### Фаза 4: Full-text + Semantic (2 недели)

1. Token dictionary + postings
2. CLIP embeddings (optional)
3. UI: Search bar

---

## 9) Заключение

**Текущая оценка: Beta / почти production-ready**

Проект реализовал ключевой пайплайн ingest→metadata→dedup→quarantine с правильной архитектурой event sourcing. Закрыты критические проблемы безопасности. Код модульный, хорошо протестирован (49 тестов).

**Для production на 1M+:**
- Добавить remaining indexes
- Протестировать на больших объёмах
- Реализовать faces/events/alboms по мере надобности

**Рекомендация:** Можно разворачивать для реального использования с текущим функционалом. Faces/Events/Albums добавлять инкрементально по запросу пользователей.

---

## 10) Сравнение с предыдущим аудитом (2026-02-17)

| Критерий | Предыдущий | Текущий | Дельта |
|----------|------------|---------|--------|
| WAL_HMAC_SECRET | fallback "dev-secret" | Обязательный | ✅ Critical fix |
| Auth | Нет | Опциональный token | ✅ Security |
| Source path validation | Нет | Allowlist roots | ✅ Security |
| Metadata extraction | Stub (ext-only) | exiftool/ffprobe | ✅ Pipeline |
| Near-dedup | Head-hash surrogate | pHash + thresholds | ✅ Pipeline |
| Derived artifacts | Нет | Thumbs/posters | ✅ Pipeline |
| Media search | Нет | Posting indexes + pagination | ✅ Feature |
| Server modularity | Монолит 1300+ строк | Разделён на модули | ✅ Code quality |
| Snapshot retention | Нет | Prune policy | ✅ Ops |
| Tests | Storage/jobs | + Server routes/bootstrap | ✅ Coverage |
| Статус | Alpha | Beta | +1 уровень |

---

## 11) Основные ссылки на код

- Server entry: `apps/server/src/index.ts`
- Server config: `apps/server/src/server-config.ts`
- Bootstrap: `apps/server/src/bootstrap.ts`
- Routes: `apps/server/src/routes.ts`
- Dev UI: `apps/server/src/ui.ts`
- Domain events: `packages/core/src/events.ts`
- Domain state: `packages/storage/src/state.ts`
- WAL: `packages/storage/src/wal.ts`
- Snapshot: `packages/storage/src/snapshot.ts`
- Rebuild: `packages/storage/src/rebuild.ts`
- Vault: `packages/storage/src/vault.ts`
- Job engine: `packages/jobs/src/job-engine.ts`
- Scan: `packages/jobs/src/scan.ts`
- Ingest: `packages/jobs/src/ingest.ts`
- Metadata: `packages/jobs/src/metadata.ts`
- Derived: `packages/jobs/src/derived.ts`
- Dedup: `packages/jobs/src/dedup.ts`
- Quarantine: `packages/jobs/src/quarantine.ts`
