# Family Media Vault — Project Audit
**Дата:** 2026-02-16  
**Версия:** v0.1.0  
**Аудитор:** Cascade AI (GPT-5.2)

---

## Executive Summary

**Статус проекта:** 🟡 **Prototype/Alpha** (40–50% от MVP)

**Ключевые достижения:**
- ✅ Реализована базовая инфраструктура хранения (WAL + snapshots + content-addressed vault)
- ✅ Построен event-driven пайплайн scan → ingest → metadata → dedup
- ✅ Работает Job Engine с идемпотентностью и resume
- ✅ Exact (L0) и Probable (L2) дедупликация с карантином
- ✅ HTTP API + минимальный web viewer

**Критичные пробелы:**
- ❌ Отсутствуют Stage D (derived: thumbs/posters), E (near-dedup по phash), F (indexes)
- ❌ Нет пайплайна лиц (Face Pipeline), событий (Event Pipeline), альбомов
- ❌ Отсутствует exiftool/ffprobe для метаданных (только заглушка)
- ❌ Нет UI для browsing Library, timeline, search
- ❌ Не протестирована масштабируемость 1M+ файлов

---

## 1. Архитектура и соответствие ТЗ

### 1.1 Общая архитектура

| Компонент | ТЗ | Факт | Оценка |
|-----------|-----|------|--------|
| WAL (append-only log) | ✅ Обязателен | ✅ Реализован с HMAC integrity | 🟢 Excellent |
| Snapshots (rebuild) | ✅ Обязателен | ✅ Реализован с zstd compression | 🟢 Excellent |
| Content-addressed Vault | ✅ Обязателен | ✅ sha256-based storage | 🟢 Excellent |
| Job Engine | ✅ Обязателен | ✅ С concurrency control | 🟢 Good |
| Domain State (in-memory) | ✅ Обязателен | ✅ Event-sourced | 🟢 Excellent |
| Incremental scanning | ✅ Обязателен | ✅ Fingerprinting (size+mtime+head64k) | 🟢 Good |
| HTTP API | ✅ Требуется | ✅ Minimal REST API | 🟡 Basic |
| Web UI | ✅ Требуется | ✅ Embedded HTML viewer | 🟡 Minimal |

**Вердикт:** Базовая архитектура **соответствует принципам** из ТЗ §0. Event sourcing, immutability, инкрементальность заложены корректно.

---

### 1.2 Ingest Pipeline (§5)

| Stage | ТЗ | Факт | Оценка |
|-------|-----|------|--------|
| **Stage A** (hash) | ✅ sha256 streaming | ✅ Реализован | 🟢 |
| **Stage B** (exact dedup L0) | ✅ Автоскип | ✅ Реализован + DuplicateLink | 🟢 |
| **Stage C** (metadata) | ✅ exiftool/ffprobe | ⚠️ Только заглушка (kind по расширению) | 🔴 |
| **Stage D** (derived) | ✅ thumbs/posters | ❌ Не реализован | 🔴 |
| **Stage E** (near-dedup) | ✅ pHash/dHash → L1/L2/L3 | ⚠️ Частично: L2 по head-hash (заглушка) | 🔴 |
| **Stage F** (index update) | ✅ Posting lists | ❌ Не реализован | 🔴 |

**Проблемы:**
1. **Metadata extraction** использует только расширение файла — критично для поиска по датам/geolocation.
2. **Отсутствуют превью** (thumbs 512/1024, video posters) — невозможен viewer.
3. **Near-dedup** реализован как заглушка через `head-hash` вместо perceptual hashes (pHash/dHash).
4. **Indexes** отсутствуют — при 1M+ файлов поиск станет O(N) по памяти.

---

### 1.3 Дедупликация (§6)

| Уровень | ТЗ | Факт | Оценка |
|---------|-----|------|--------|
| **L0 Exact** | sha256 match → автоскип | ✅ Работает | 🟢 |
| **L1 Strong** | pHash ≤4, dHash ≤6 → автоскип | ❌ Не реализован | 🔴 |
| **L2 Probable** | pHash ≤10 → карантин | ⚠️ Реализован через head-hash (заглушка) | 🟡 |
| **L3 Unique** | Импорт в Vault | ✅ Работает | 🟢 |

**Текущая логика L2:**
```typescript
// dedup.ts: использует head64k sha256 вместо perceptual hash
const existing = state.media.getByHeadHash(headHash);
if (existing.length > 0) {
  // создаётся карантин
}
```

**Проблема:** Head-hash не детектирует resized/compressed дубликаты. Требуется pHash/dHash для изображений.

---

### 1.4 Quarantine Workflow (§6.4)

| Требование | Факт | Оценка |
|------------|------|--------|
| Preview 512 | ❌ Нет derived | 🔴 |
| Ссылка на sourceEntry | ✅ Хранится | 🟢 |
| Top-3 кандидата | ✅ candidateMediaIds[] | 🟢 |
| Статус pending/accepted/rejected | ✅ Реализован | 🟢 |
| Accept/Reject API | ✅ Реализован через jobs | 🟢 |
| UI для просмотра | ⚠️ Базовый HTML viewer | 🟡 |

**Вердикт:** Логика карантина работает, но без превью невозможно принять осознанное решение.

---

## 2. Качество кода

### 2.1 Type Safety

**Оценка: 🟢 Excellent**

- ✅ Строгие типы TypeScript во всех пакетах
- ✅ Branded types для ID (`EventId`, `MediaId`, `SourceId` и т.д.) — предотвращает путаницу
- ✅ Нет `any` или `@ts-ignore` (найдено 0 случаев)
- ✅ Используется `JsonObject` для payload вместо `any`

**Примеры:**
```typescript
// core/ids.ts
export type MediaId = Branded<string, "MediaId">;
export const newMediaId = (): MediaId => newBranded("MediaId", "med");
export const asMediaId = (value: string): MediaId => brandId(value, "MediaId");
```

**Рекомендация:** Отличная практика, продолжать в том же духе.

---

### 2.2 Code Organization

**Оценка: 🟢 Good**

**Структура пакетов:**
```
packages/
  core/          # Domain types, events, IDs, invariants
  storage/       # WAL, snapshots, vault, hash, state
  jobs/          # Job engine, handlers (scan/ingest/metadata/dedup/quarantine)
apps/
  server/        # HTTP API + embedded UI
```

**Плюсы:**
- ✅ Чёткое разделение: core → storage → jobs → server
- ✅ Отсутствие циклических зависимостей
- ✅ Exports организованы через index.ts

**Минусы:**
- ⚠️ `apps/server/src/index.ts` — **1391 строк** в одном файле (API + UI в одном месте)
- ⚠️ Встроенный HTML viewer (~600 строк JavaScript в строковом литерале)

**Рекомендация:** 
1. Разбить `server/src/index.ts` на модули: `api/`, `ui/`, `app.ts`
2. Вынести UI в отдельный пакет `apps/web` (React/Vite)

---

### 2.3 Error Handling

**Оценка: 🟡 Adequate**

**Плюсы:**
- ✅ Custom error classes (`InvariantError`, `WalIntegrityError`)
- ✅ WAL integrity verification с hash chain
- ✅ Автоматическое восстановление при повреждённом WAL (backup + clean start)

**Пример восстановления:**
```typescript
// apps/server/src/index.ts:98-114
try {
  state = await rebuildDomainState({ walDir, snapshotsDir, hmacSecret });
  writer = await WalWriter.create({ walDir, hmacSecret, fsync: true });
  jobStore = await rebuildJobStore(...);
} catch {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.rename(walDir, `${walDir}.corrupt.${stamp}`);
  await fs.rename(snapshotsDir, `${snapshotsDir}.corrupt.${stamp}`);
  // Start fresh
}
```

**Минусы:**
- ⚠️ API endpoints не возвращают структурированные ошибки (JSON с code/message)
- ⚠️ Нет логирования (console.error отсутствует)

**Рекомендация:** Добавить structured logging (pino/winston) и error codes.

---

### 2.4 Testing

**Оценка: 🟡 Moderate**

**Покрытие:**
| Пакет | Тесты | Покрытие (оценка) |
|-------|-------|-------------------|
| `core` | ❌ Нет | 0% |
| `storage` | ✅ 4 test files | ~60% |
| `jobs` | ✅ 4 test files | ~70% |
| `server` | ❌ Нет | 0% |

**Всего тестов:** 13 passed (8 test files)

**Существующие тесты:**
- ✅ `snapshot.test.ts` — WAL snapshot write/read
- ✅ `wal.test.ts` — WAL append + integrity verification
- ✅ `state-snapshot.test.ts` — Domain state roundtrip
- ✅ `rebuild.test.ts` — Rebuild from snapshot + WAL tail
- ✅ `job-engine.test.ts` — Job execution + concurrency
- ✅ `job-store.test.ts` — Job state transitions
- ✅ `scan-ingest.test.ts` — Integration: scan → ingest → metadata → dedup
- ✅ `quarantine.test.ts` — Quarantine accept/reject

**Отсутствуют:**
- ❌ Тесты для `core` (events, IDs, invariants)
- ❌ E2E тесты для API
- ❌ Load tests для 1M+ файлов
- ❌ Tests для recovery/corruption scenarios

**Рекомендация:**
1. Добавить тесты для `core` пакета
2. Написать API integration tests (supertest/vitest)
3. Создать benchmark для 100k/1M файлов (профилирование памяти)

---

## 3. Инфраструктурные риски

### 3.1 Масштабируемость

**Оценка: 🟡 Untested at scale**

**Потенциальные проблемы:**

1. **DomainState в памяти (полностью)**
   - При 1M media + 1M entries + metadata → **~500MB–1GB RAM**
   - При 10M → OOM на 8GB машине
   - **Решение:** Lazy-loading или sharding индексов

2. **Snapshot размер**
   - 1M записей × 200 байт JSON ≈ **200MB uncompressed**
   - С zstd ≈ 50–80MB (приемлемо)
   - Проблема: rebuild при старте занимает секунды

3. **Job Engine concurrency**
   - Текущий лимит: `concurrency: 2`
   - Для 1M файлов scan+ingest может занять **дни**
   - **Решение:** Настраиваемые пулы (IO/CPU/GPU)

4. **Отсутствие indexes**
   - Поиск по датам/типам/источникам — **O(N) по памяти**
   - При 1M файлов поиск займёт секунды
   - **Решение:** Posting lists/inverted indexes (как в ТЗ §8.2)

**Рекомендация:** Провести stress-тест с 100k реальных файлов.

---

### 3.2 Data Durability

**Оценка: 🟢 Good**

**Плюсы:**
- ✅ WAL с fsync (гарантия записи на диск)
- ✅ HMAC integrity + hash chain (детектирует повреждения)
- ✅ Автоматический backup при corruption

**Минусы:**
- ⚠️ Отсутствует snapshot rotation (только `pointer.json`)
- ⚠️ Нет механизма для ручного recovery

**Рекомендация:** 
1. Snapshot rotation: хранить последние N snapshots
2. CLI команда для export/import snapshot

---

### 3.3 Security

**Оценка: 🔴 Critical gaps**

**Проблемы:**

1. **HMAC secret hardcoded**
   ```typescript
   const hmacSecret = process.env.WAL_HMAC_SECRET ?? "dev-secret";
   ```
   ❌ Default "dev-secret" в production — катастрофа

2. **Нет authentication/authorization**
   - API endpoints открыты без токенов
   - `/fs/dialog` позволяет читать любые папки

3. **Path traversal risk**
   - User input (source.path) не валидируется
   - Возможен доступ к системным папкам

4. **CORS/CSRF**
   - Отсутствует CORS policy
   - Нет CSRF protection

**Рекомендация (критично для production):**
1. Требовать `WAL_HMAC_SECRET` из environment
2. Добавить JWT/session-based auth
3. Валидировать все пользовательские пути (allowlist)
4. Добавить rate limiting

---

## 4. Отсутствующие фичи (vs ТЗ)

### 4.1 Приоритет: Критичный

| Фича | ТЗ § | Статус | Impact |
|------|------|--------|--------|
| Exiftool/ffprobe metadata | 5.1 Stage C | ❌ | Нет дат/GPS → нет timeline/events |
| Derived (thumbs/posters) | 5.1 Stage D | ❌ | Нет превью → нет viewer |
| pHash/dHash near-dedup | 5.1 Stage E | ❌ | L1/L2 не работают → много дубликатов |
| Inverted indexes | 5.1 Stage F | ❌ | Поиск не масштабируется |

---

### 4.2 Приоритет: Высокий

| Фича | ТЗ § | Статус | Impact |
|------|------|--------|--------|
| Face Pipeline | 7 | ❌ | Нет поиска по людям |
| Event Pipeline | 8 | ❌ | Нет автоматических событий |
| Albums | 9 | ❌ | Нет организации |
| Timeline UI | 10.2 | ❌ | Нет browsing |
| Search/Filters UI | 10.3 | ❌ | Нет UX |

---

### 4.3 Приоритет: Средний

| Фича | ТЗ § | Статус | Impact |
|------|------|--------|--------|
| GPU pipeline (faces/embeddings) | 7.3 | ❌ | Медленная обработка лиц |
| Telegram bot | 10.6 | ❌ | Нет sharing |
| Video transcoding | 11.2 | ❌ | Нет оптимизации видео |
| Configurable dedup rules | 6.3 | ❌ | Нет гибкости |

---

## 5. Технический долг

### 5.1 Высокий приоритет

1. **Monolithic server file** (`apps/server/src/index.ts` — 1391 строк)
   - Сложно тестировать
   - UI embedded как строка

2. **Отсутствие logging**
   - Нет audit trail
   - Невозможно дебажить production

3. **Hardcoded configuration**
   - Concurrency, paths, ports — всё захардкожено
   - Нет config.yaml

4. **Отсутствие CLI**
   - Нет команд для snapshot/rebuild/export
   - Нет health checks

---

### 5.2 Средний приоритет

1. **Metadata extraction заглушка**
   - Только расширение файла
   - Требуется интеграция exiftool/ffprobe

2. **Near-dedup заглушка**
   - Head-hash вместо perceptual hashes
   - Требуется sharp + image-hash

3. **UI как строка в коде**
   - 600+ строк HTML+JS в одном литерале
   - Невозможно использовать современный tooling

4. **Отсутствие API documentation**
   - Нет OpenAPI/Swagger spec
   - Нет примеров использования

---

## 6. Performance Анализ

### 6.1 Узкие места (потенциальные)

1. **Sequential job processing**
   - Concurrency = 2 → медленный ingest
   - Для 1M файлов × 5s/file = **58 дней**
   - **Решение:** Увеличить concurrency + worker pools

2. **SHA256 для всех файлов**
   - Streaming hash — O(filesize)
   - Для 1TB данных = часы работы
   - **Оптимизация:** Parallelization + пропуск unchanged

3. **DomainState lookup — O(1) но в памяти**
   - Map-based indexes работают быстро
   - Но весь state в RAM → ограничение масштаба

4. **Snapshot rebuild**
   - Чтение + десериализация 1M записей ≈ 5–10s
   - При каждом старте сервера
   - **Решение:** Lazy loading или mmap

---

### 6.2 Оптимизации (реализованные)

✅ **WAL segments** (256MB chunks) — ротация работает  
✅ **Content-addressed storage** (sha256) — дедупликация файлов автоматическая  
✅ **Snapshot compression** (zstd) — размер уменьшен ~4×  
✅ **Fingerprinting** (size+mtime+head64k) — скип неизменённых файлов

---

## 7. Рекомендации

### 7.1 Краткосрочные (1–2 недели)

**Приоритет 1: Derived + Metadata**
- [ ] Интегрировать sharp для thumbs (512/1024)
- [ ] Интегрировать exiftool для EXIF
- [ ] Добавить ffprobe для video metadata
- [ ] Реализовать Stage D полностью

**Приоритет 2: Near-dedup**
- [ ] Добавить pHash/dHash (image-hash/blockhash-js)
- [ ] Реализовать scoring rules из ТЗ §6.3
- [ ] Заменить head-hash на perceptual hashes

**Приоритет 3: Security**
- [ ] Убрать default HMAC secret
- [ ] Добавить auth middleware
- [ ] Валидировать source paths

---

### 7.2 Среднесрочные (1–2 месяца)

**Приоритет 1: Indexes**
- [ ] Реализовать posting lists (Stage F)
- [ ] Добавить date/kind/source indexes
- [ ] Benchmark на 100k файлов

**Приоритет 2: UI**
- [ ] Создать `apps/web` (React + Vite)
- [ ] Timeline view с thumbnails
- [ ] Search/filters UI

**Приоритет 3: Face Pipeline**
- [ ] Интегрировать insightface (ONNX)
- [ ] Реализовать Stage G (face detection)
- [ ] Кластеризация лиц

---

### 7.3 Долгосрочные (3+ месяцев)

- [ ] Event Pipeline (автоопределение событий)
- [ ] Albums + sharing
- [ ] Telegram bot
- [ ] Multi-user support
- [ ] Cloud backup integration

---

## 8. Выводы

### 8.1 Сильные стороны

1. ✅ **Архитектура масштабируема** — event sourcing + WAL + snapshots
2. ✅ **Инкрементальность** — fingerprinting работает корректно
3. ✅ **Type safety** — branded types, строгий TypeScript
4. ✅ **Job Engine** — идемпотентность, resume, concurrency control
5. ✅ **Data durability** — WAL integrity + автовосстановление

### 8.2 Критичные пробелы

1. ❌ **Metadata extraction** — заглушка вместо exiftool/ffprobe
2. ❌ **Derived pipeline** — нет превью/thumbs
3. ❌ **Near-dedup** — head-hash вместо perceptual hashes
4. ❌ **Indexes** — нет поддержки поиска
5. ❌ **Security** — открытые endpoints, default secrets

### 8.3 Итоговая оценка

**Текущий статус:** 🟡 **Prototype/Alpha**  
**Готовность к MVP:** **40–50%**  
**Технический долг:** 🟡 **Moderate** (управляем)  
**Рекомендация:** 🔶 **Продолжить разработку** — фундамент крепкий, нужны фичи

---

## Приложение A: Metrics

**Codebase:**
- TypeScript files: ~30 files
- Lines of code (estimate): ~4000 LOC (packages + server)
- Test files: 8
- Test coverage: ~40% (estimate)

**Architecture:**
- Packages: 3 (core, storage, jobs)
- Apps: 1 (server)
- Domain events: 15 types
- Job kinds: 6 (scan, ingest, metadata, dedup, quarantine:accept, quarantine:reject)

**Implemented vs Spec:**
- Stages A–C: ✅ (Basic)
- Stage D: ❌
- Stage E: ⚠️ (Stub)
- Stage F: ❌
- Face/Event/Albums: ❌

---

**Конец аудита.**

*Для вопросов или уточнений см. `docs/Family_Media_Vault_Full_TZ_Scalable_v2.md` §§ соответствующих разделов.*
