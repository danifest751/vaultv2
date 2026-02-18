import { performance } from "node:perf_hooks";
import { asMediaId, asSourceEntryId, asSourceId, createEvent } from "@family-media-vault/core";
import { DomainState, MediaSearchFilters, MediaSearchSort } from "@family-media-vault/storage";

interface BenchOptions {
  count: number;
  runs: number;
  warmupRuns: number;
}

interface QueryCase {
  name: string;
  filters: MediaSearchFilters;
  sort: MediaSearchSort;
}

interface Stats {
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  avgMs: number;
}

function parseOptions(argv: string[]): BenchOptions {
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, value] = arg.slice(2).split("=", 2);
    if (!key || !value) {
      continue;
    }
    values.set(key, value);
  }

  return {
    count: parsePositiveInt(values.get("count"), 100_000),
    runs: parsePositiveInt(values.get("runs"), 20),
    warmupRuns: parsePositiveInt(values.get("warmup"), 5)
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function makeSha256(index: number): string {
  const base = index.toString(16).padStart(8, "0");
  return base.repeat(8).slice(0, 64);
}

function memoryMb(value: number): string {
  return (value / (1024 * 1024)).toFixed(1);
}

function buildSyntheticState(count: number): DomainState {
  const state = new DomainState();
  const sourceId = asSourceId("src_bench_media_search");

  state.applyEvent(
    createEvent("SOURCE_CREATED", {
      source: {
        sourceId,
        path: "C:/bench/source",
        recursive: true,
        includeArchives: false,
        excludeGlobs: [],
        createdAt: 1
      }
    })
  );

  const baseTakenAt = Date.parse("2024-01-01T00:00:00.000Z");

  for (let index = 0; index < count; index += 1) {
    const sourceEntryId = asSourceEntryId(`se_bench_${index.toString(16).padStart(8, "0")}`);
    const mediaId = asMediaId(`med_bench_${index.toString(16).padStart(8, "0")}`);
    const sha256 = makeSha256(index);
    const takenAt = baseTakenAt + (index % 365) * 86_400_000;

    state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId,
          sourceId,
          kind: "file",
          path: `C:/bench/source/${index}.jpg`,
          size: 1_024 + (index % 8_192),
          mtimeMs: 1_000 + index,
          fingerprint: `${1_024 + (index % 8_192)}:${1_000 + index}:head-${index}`,
          lastSeenAt: 2_000 + index,
          state: "active"
        }
      })
    );

    state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId,
          sha256,
          size: 1_024 + (index % 8_192),
          sourceEntryId
        }
      })
    );

    state.applyEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId,
        sourceEntryId,
        metadata: {
          kind: index % 2 === 0 ? "photo" : "video",
          mimeType: index % 2 === 0 ? "image/jpeg" : "video/mp4",
          cameraModel: index % 3 === 0 ? "Canon EOS R6" : "Sony A7",
          takenAt,
          raw: {
            gpsLatitude: 55.7 + (index % 2) * 0.1,
            gpsLongitude: 37.6 + (index % 2) * 0.1
          }
        }
      })
    );
  }

  return state;
}

function runCase(
  state: DomainState,
  queryCase: QueryCase,
  runs: number,
  warmupRuns: number
): { stats: Stats; resultSize: number } {
  for (let run = 0; run < warmupRuns; run += 1) {
    state.mediaSearch.query(queryCase.filters, state, queryCase.sort);
  }

  const durations: number[] = [];
  let resultSize = 0;

  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now();
    const result = state.mediaSearch.query(queryCase.filters, state, queryCase.sort);
    const elapsedMs = performance.now() - startedAt;
    durations.push(elapsedMs);
    resultSize = result.length;
  }

  durations.sort((left, right) => left - right);
  const sum = durations.reduce((acc, value) => acc + value, 0);

  return {
    stats: {
      minMs: durations[0] ?? 0,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: durations[durations.length - 1] ?? 0,
      avgMs: durations.length > 0 ? sum / durations.length : 0
    },
    resultSize
  };
}

function percentile(sorted: number[], rank: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * rank)));
  return sorted[index] ?? 0;
}

function printHeader(options: BenchOptions): void {
  process.stdout.write("media-search benchmark\n");
  process.stdout.write(`count=${options.count}, runs=${options.runs}, warmup=${options.warmupRuns}\n`);
}

function printMemory(prefix: string): void {
  const mem = process.memoryUsage();
  process.stdout.write(
    `${prefix}: rss=${memoryMb(mem.rss)}MB heapUsed=${memoryMb(mem.heapUsed)}MB heapTotal=${memoryMb(mem.heapTotal)}MB\n`
  );
}

function printResult(queryCase: QueryCase, resultSize: number, stats: Stats): void {
  process.stdout.write(
    [
      queryCase.name,
      `result=${resultSize}`,
      `min=${stats.minMs.toFixed(2)}ms`,
      `p50=${stats.p50Ms.toFixed(2)}ms`,
      `p95=${stats.p95Ms.toFixed(2)}ms`,
      `avg=${stats.avgMs.toFixed(2)}ms`,
      `max=${stats.maxMs.toFixed(2)}ms`
    ].join(" | ") + "\n"
  );
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  printHeader(options);
  printMemory("before_build");

  const buildStartedAt = performance.now();
  const state = buildSyntheticState(options.count);
  const buildElapsedMs = performance.now() - buildStartedAt;

  printMemory("after_build");
  process.stdout.write(`build_elapsed=${buildElapsedMs.toFixed(2)}ms\n`);

  const sampleShaPrefix = makeSha256(Math.floor(options.count / 3)).slice(0, 8);
  const sampleTakenDay = "2024-02-12";

  const cases: QueryCase[] = [
    {
      name: "kind=photo sort=mediaId_asc",
      filters: { kind: "photo" },
      sort: "mediaId_asc"
    },
    {
      name: "cameraModel=canon eos r6 sort=takenAt_desc",
      filters: { cameraModel: "canon eos r6" },
      sort: "takenAt_desc"
    },
    {
      name: `takenDay=${sampleTakenDay} sort=takenAt_desc`,
      filters: { takenDay: sampleTakenDay },
      sort: "takenAt_desc"
    },
    {
      name: `sha256Prefix=${sampleShaPrefix} sort=mediaId_asc`,
      filters: { sha256Prefix: sampleShaPrefix },
      sort: "mediaId_asc"
    },
    {
      name: "kind+cameraModel+sha256Prefix",
      filters: {
        kind: "photo",
        cameraModel: "canon eos r6",
        sha256Prefix: sampleShaPrefix.slice(0, 4)
      },
      sort: "mediaId_asc"
    }
  ];

  for (const queryCase of cases) {
    const { stats, resultSize } = runCase(state, queryCase, options.runs, options.warmupRuns);
    printResult(queryCase, resultSize, stats);
  }

  printMemory("after_queries");
}

main();
