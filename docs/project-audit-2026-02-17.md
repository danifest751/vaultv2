# Аудит проекта Family Media Vault

**Дата:** 2026-02-17  
**Область:** текущая реализация `apps/server`, `packages/core`, `packages/storage`, `packages/jobs`  
**Формат:** технический аудит по ТЗ (масштаб 1M+, инкрементальность, WAL+snapshot, rebuild, дедуп+карантин)

---

## 1) Summary

Проект имеет **сильный фундамент event-sourcing архитектуры**: WAL с hash-chain/HMAC, snapshot/rebuild, immutable vault-хранилище, jobs-пайплайн scan→ingest→metadata→dedup, и базовые тесты на критические механизмы.

При этом статус по отношению к целевому production из ТЗ — **прототип (alpha)**:

- ✅ Есть правильные опорные инварианты: no SQL, WAL+snapshot, incremental scanning, idempotent job-поведение на уровне событий.
- ⚠️ Не закрыты ключевые production-требования: реальный metadata extraction (exiftool/ffprobe), derived artifacts (thumbs/posters), полноценный near-duplicate (pHash/dHash), индексные структуры для масштабного поиска.
- 🔴 Есть критические риски безопасности и эксплуатации: дефолтный `WAL_HMAC_SECRET`, отсутствие authn/authz, отсутствуют ограничения на source paths.

---

## 2) Что проверено

- Архитектурные точки входа и wiring серверного приложения.
- Слой хранения (`WAL`, `snapshot`, `rebuild`, `DomainState`, `Vault`).
- Job engine и job handlers (`scan`, `ingest`, `metadata`, `dedup`, `quarantine`).
- Набор тестов в `storage` и `jobs`.
- Документация репозитория и текущее состояние структуры.

---

## 3) Сильные стороны

1. **WAL с контролем целостности и последовательности**  
   - Проверяется `schemaVersion`, `seq`, `prevHash`, HMAC hash chain при чтении WAL.  
   - Это хороший фундамент для детерминированного восстановления состояния.  

2. **Rebuild состояния из snapshot + WAL tail**  
   - Реализован path: pointer snapshot → загрузка snapshot records → replay WAL c `seq > walSeq`.  
   - Поддерживает fast-start и консистентность после рестарта.

3. **Инкрементальный scan без полного перерасчёта неизменённых файлов**  
   - В scan учитывается существующая запись, fingerprint и enqueue ingest только для новых/изменённых файлов.  
   - Есть тест на повторный scan без повторного ingest.

4. **Иммутабельная модель хранения контента в Vault (content-addressed)**  
   - Файл кладётся по пути, вычисляемому из `sha256`; повторная запись не дублирует контент.

5. **Resumable jobs на уровне событий**  
   - При старте `resumePending()` переводит `running -> queued` и продолжает runnable задачи.  
   - Поддерживается идемпотентность через event-driven состояние.

---

## 4) Критические замечания (по приоритету)

### Critical

1. **Небезопасный дефолт секрета WAL**  
   - Используется fallback `"dev-secret"` при отсутствии env-переменной.  
   - Риск: целостность WAL в production зависит от предсказуемого секрета.

2. **Нет аутентификации/авторизации API**  
   - Все endpoints открыты без auth middleware.  
   - Для production media vault это блокер.

3. **Не валидируются пути источников (source path trust issue)**  
   - `POST /sources` принимает путь и сохраняет без policy-валидации (allowlist/sandbox).  
   - Риск несанкционированного сканирования файловой системы.

### High

4. **Metadata extraction — заглушка по расширению**  
   - `extractBasicMetadata` определяет kind/mime только по ext и `mtime`.  
   - Нет EXIF/video метаданных для timeline/search качества.

5. **Near-dedup реализован как вероятностный суррогат по head-hash**  
   - В `dedup` используются кандидаты по совпадению ключа fingerprint (size + head hash).  
   - Нет pHash/dHash/robust similarity: слабая устойчивость к resize/re-encode.

6. **Отсутствуют derived artifacts (thumbs/posters)**  
   - Нет Stage D, UI и quarantine остаются без качественных превью.

7. **Монолитный server entrypoint (~1300+ строк)**  
   - HTTP API, UI, fs-dialog и orchestration в одном файле.  
   - Высокая связность и сложность регрессионного тестирования.

### Medium

8. **Ограниченное покрытие тестами**  
   - Есть тесты storage/jobs, но нет тестов server API и почти нет unit-тестов core-инвариантов.

9. **Snapshot lifecycle минимальный**  
   - Реализован pointer и создание snapshot, но нет retention/rotation/policy cleanup.

10. **Фиксированный concurrency в JobEngine wiring**  
   - Сейчас `concurrency: 2` в server wiring; на 1M+ файлов это операционно узко.

---

## 5) Проверка ключевых инвариантов ТЗ

| Инвариант | Статус | Комментарий |
|---|---|---|
| No SQL/SQLite | ✅ | Реализация полностью file-based (`WAL`, `snapshot`, in-memory state). |
| WAL + Snapshot | ✅ | Реализованы append/read/verify + snapshot pointer/rebuild. |
| Rebuild индексов/состояния | ⚠️ | Rebuild domain state есть; отдельного индекса поиска (Stage F) пока нет. |
| Immutable media в Vault | ✅ | Контент кладётся по `sha256`, derived не смешаны с raw media. |
| Long operations = jobs | ✅ | Scan/Ingest/Metadata/Dedup/Quarantine выполняются через JobEngine. |
| Idempotent/resumable jobs | ✅ | Event-driven store + resume pending реализованы. |
| Инкрементальность (без полного пересчёта при добавлении Source) | ✅ | Scan обрабатывает только изменённые/new entries через fingerprint/identity. |
| Dedup + quarantine | ⚠️ | Exact dedup + quarantine есть; near-dedup эвристика упрощённая. |

---

## 6) Что уже хорошо покрыто тестами

- WAL append/read/integrity.
- Snapshot write/read и rebuild из snapshot + WAL tail.
- Интеграционный путь scan→ingest→metadata→dedup.
- Quarantine accept/reject.

Тесты подтверждают корректность базовой вертикали, но **не закрывают** API-контракты, безопасность и масштабные сценарии (100k/1M+).

---

## 7) Рекомендуемый план улучшений (практичный)

### Фаза A (срочно, 3–5 дней)

1. Убрать insecure defaults:
   - обязательный `WAL_HMAC_SECRET` без fallback;
   - fail-fast на старте при отсутствии секрета.
2. Ввести базовый auth слой (минимум token-based для private deployment).
3. Ввести policy валидации source paths (allowlist root directories).

### Фаза B (1–2 недели)

1. Реальный metadata pipeline:
   - exiftool для фото,
   - ffprobe для видео,
   - нормализация metadata в domain events.
2. Derived pipeline (thumbs/posters) как jobs (idempotent/resumable).
3. Разбиение `apps/server/src/index.ts` на модули: routing, handlers, ui/static.

### Фаза C (2–4 недели)

1. Near-dedup на perceptual hashes (pHash/dHash) + правила confidence.
2. Stage F индексы (posting lists) для быстрых фильтров/поиска.
3. Бенчмарки и soak-тесты: 100k → 1M entries (RAM, rebuild time, throughput).

---

## 8) Заключение

Проект движется в правильной архитектурной парадигме и уже содержит важные production-принципы (event sourcing, WAL integrity, rebuild, incremental jobs).  
Для выхода к production-ready состоянию нужно в первую очередь закрыть **security baseline** и **pipeline completeness** (metadata/derived/near-dedup/indexes).

Текущая оценка: **Alpha / крепкий фундамент, но не production-ready**.

---

## 9) Основные ссылки на код (evidence)

- Server bootstrap, wiring, API, секрет по умолчанию: `apps/server/src/index.ts`
- Job engine и resume: `packages/jobs/src/job-engine.ts`
- Scan incremental logic: `packages/jobs/src/scan.ts`
- Ingest exact dedup + duplicate links: `packages/jobs/src/ingest.ts`
- Probable dedup + quarantine: `packages/jobs/src/dedup.ts`
- Domain state stores: `packages/storage/src/state.ts`
- WAL verify/hash-chain: `packages/storage/src/wal.ts`
- Snapshot write/read: `packages/storage/src/snapshot.ts`
- Rebuild from snapshot + WAL: `packages/storage/src/rebuild.ts`
- Vault content-addressed storage: `packages/storage/src/vault.ts`
- Metadata stub: `packages/storage/src/metadata.ts`
- Интеграционные тесты scan/ingest/dedup: `packages/jobs/src/__tests__/scan-ingest.test.ts`
- Rebuild test: `packages/storage/src/__tests__/rebuild.test.ts`
