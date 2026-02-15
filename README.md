# Family Media Vault

Production-grade, TypeScript-only monorepo for a large-scale, incremental media vault.

## Repository structure
The authoritative repository layout is documented in [docs/repository-structure.md](docs/repository-structure.md).

## Guiding principles (fixed)
- Scale: 1M+ files; no full rescans on new Source.
- Storage: WAL + snapshots; indexes can be rebuilt.
- Dedup: quarantine-first; immutable media in Vault.
- Long operations: jobs only; idempotent and resumable.
- No SQL/SQLite.
