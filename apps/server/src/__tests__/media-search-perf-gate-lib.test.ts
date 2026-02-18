import { describe, expect, it } from "vitest";
import {
  evaluatePerfBudgets,
  parseBenchmarkMetrics,
  parsePerfGateOptions
} from "../benchmarks/media-search-perf-gate-lib";

describe("media-search perf gate lib", () => {
  it("parses perf gate options with defaults", () => {
    const options = parsePerfGateOptions([]);

    expect(options.count).toBe(100_000);
    expect(options.runs).toBe(10);
    expect(options.warmupRuns).toBe(3);
    expect(options.p95BudgetMs).toBe(120);
    expect(options.avgBudgetMs).toBe(80);
  });

  it("parses perf gate options from CLI flags", () => {
    const options = parsePerfGateOptions([
      "--count=50000",
      "--runs=12",
      "--warmup=4",
      "--p95-budget=55",
      "--avg-budget=40"
    ]);

    expect(options.count).toBe(50_000);
    expect(options.runs).toBe(12);
    expect(options.warmupRuns).toBe(4);
    expect(options.p95BudgetMs).toBe(55);
    expect(options.avgBudgetMs).toBe(40);
  });

  it("parses benchmark result lines and ignores unrelated output", () => {
    const output = [
      "media-search benchmark",
      "kind=photo sort=mediaId_asc | result=50000 | min=6.52ms | p50=7.09ms | p95=9.36ms | avg=7.15ms | max=9.36ms",
      "cameraModel=canon eos r6 sort=takenAt_desc | result=33334 | min=28.10ms | p50=30.52ms | p95=33.85ms | avg=30.40ms | max=33.85ms",
      "after_queries: rss=299.5MB heapUsed=235.2MB heapTotal=262.7MB"
    ].join("\n");

    const metrics = parseBenchmarkMetrics(output);

    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toEqual({
      name: "kind=photo sort=mediaId_asc",
      resultSize: 50_000,
      minMs: 6.52,
      p50Ms: 7.09,
      p95Ms: 9.36,
      avgMs: 7.15,
      maxMs: 9.36
    });
    expect(metrics[1]?.name).toBe("cameraModel=canon eos r6 sort=takenAt_desc");
  });

  it("reports budget violations", () => {
    const metrics = [
      {
        name: "kind=photo",
        resultSize: 1,
        minMs: 1,
        p50Ms: 2,
        p95Ms: 9,
        avgMs: 6,
        maxMs: 10
      }
    ];

    const violations = evaluatePerfBudgets(metrics, {
      count: 100,
      runs: 1,
      warmupRuns: 1,
      p95BudgetMs: 8,
      avgBudgetMs: 5
    });

    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("p95=9.00ms");
    expect(violations[1]).toContain("avg=6.00ms");
  });
});
