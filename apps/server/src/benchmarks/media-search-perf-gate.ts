import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  evaluatePerfBudgets,
  parseBenchmarkMetrics,
  parsePerfGateOptions
} from "./media-search-perf-gate-lib";

function main(): void {
  const options = parsePerfGateOptions(process.argv.slice(2));
  process.stdout.write(
    `media-search perf gate: count=${options.count}, runs=${options.runs}, warmup=${options.warmupRuns}, p95<=${options.p95BudgetMs}ms, avg<=${options.avgBudgetMs}ms\n`
  );

  const benchmarkScript = path.join(__dirname, "media-search-benchmark.js");
  const child = spawnSync(
    process.execPath,
    [benchmarkScript, `--count=${options.count}`, `--runs=${options.runs}`, `--warmup=${options.warmupRuns}`],
    {
      encoding: "utf8"
    }
  );

  if (child.stdout) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }

  if (child.status !== 0) {
    throw new Error(`benchmark failed with exit code ${child.status ?? -1}`);
  }

  const metrics = parseBenchmarkMetrics(child.stdout ?? "");
  if (metrics.length === 0) {
    throw new Error("benchmark output does not contain query metrics");
  }

  const violations = evaluatePerfBudgets(metrics, options);
  if (violations.length > 0) {
    process.stderr.write("media-search perf gate failed:\n");
    for (const violation of violations) {
      process.stderr.write(` - ${violation}\n`);
    }
    throw new Error("performance budget exceeded");
  }

  process.stdout.write("media-search perf gate passed\n");
}

main();
