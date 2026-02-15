# Repository structure (authoritative)

This document fixes the intended top-level layout. Directories may be introduced gradually, but this is the canonical target structure.

```
/
  README.md
  docs/
    repository-structure.md
  apps/
    server/     # Fastify + TypeScript API
    web/        # Vite + React + TypeScript UI
  packages/
    core/       # Domain types, utils, config schema
    storage/    # WAL + snapshot + index logic
    jobs/       # Job engine + workers
    media/      # EXIF/ffprobe/thumbs/pHash
    faces/      # Face pipeline (later)
  scripts/
  vault-spec/   # Product spec + schema docs
```

## Invariants encoded by structure
- **TypeScript only**: all runtime code lives under `apps/` or `packages/` as TS.
- **Immutable media**: raw media is stored in Vault; derived data lives in `packages/index` or `packages/media` and is rebuildable.
- **Long operations are jobs**: any heavy work goes through `packages/jobs` and is run by `apps/server` or future workers.
- **Incremental by default**: source ingestion is modeled in `packages/ingest` and must be resumable.
- **No SQL**: storage primitives live in `packages/storage` with WAL + snapshots.

## How to evolve the layout
- Add new runtime subsystems as a `packages/*` library first, then wire into `apps/*`.
- Keep domain types and invariants in `packages/core`.
- New persistent data formats must be documented in `packages/storage` and versioned.
