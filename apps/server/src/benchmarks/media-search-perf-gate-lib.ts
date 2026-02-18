export interface PerfGateOptions {
  count: number;
  runs: number;
  warmupRuns: number;
  p95BudgetMs: number;
  avgBudgetMs: number;
}

export interface MediaSearchQueryMetrics {
  name: string;
  resultSize: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  avgMs: number;
  maxMs: number;
}

const RESULT_LINE_PATTERN =
  /^(?<name>.+?) \| result=(?<resultSize>\d+) \| min=(?<minMs>\d+(?:\.\d+)?)ms \| p50=(?<p50Ms>\d+(?:\.\d+)?)ms \| p95=(?<p95Ms>\d+(?:\.\d+)?)ms \| avg=(?<avgMs>\d+(?:\.\d+)?)ms \| max=(?<maxMs>\d+(?:\.\d+)?)ms$/;

function parseFlagMap(argv: string[]): Map<string, string> {
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
  return values;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0.1, parsed);
}

export function parsePerfGateOptions(argv: string[]): PerfGateOptions {
  const flags = parseFlagMap(argv);
  return {
    count: parsePositiveInteger(flags.get("count"), 100_000),
    runs: parsePositiveInteger(flags.get("runs"), 10),
    warmupRuns: parsePositiveInteger(flags.get("warmup"), 3),
    p95BudgetMs: parsePositiveNumber(flags.get("p95-budget"), 120),
    avgBudgetMs: parsePositiveNumber(flags.get("avg-budget"), 80)
  };
}

export function parseBenchmarkMetrics(output: string): MediaSearchQueryMetrics[] {
  const metrics: MediaSearchQueryMetrics[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(RESULT_LINE_PATTERN);
    if (!match?.groups) {
      continue;
    }

    const {
      name,
      resultSize,
      minMs,
      p50Ms,
      p95Ms,
      avgMs,
      maxMs
    } = match.groups as Record<string, string | undefined>;
    if (!name || !resultSize || !minMs || !p50Ms || !p95Ms || !avgMs || !maxMs) {
      continue;
    }

    const parsed: MediaSearchQueryMetrics = {
      name: name.trim(),
      resultSize: Number.parseInt(resultSize, 10),
      minMs: Number.parseFloat(minMs),
      p50Ms: Number.parseFloat(p50Ms),
      p95Ms: Number.parseFloat(p95Ms),
      avgMs: Number.parseFloat(avgMs),
      maxMs: Number.parseFloat(maxMs)
    };

    if (
      !Number.isFinite(parsed.resultSize) ||
      !Number.isFinite(parsed.minMs) ||
      !Number.isFinite(parsed.p50Ms) ||
      !Number.isFinite(parsed.p95Ms) ||
      !Number.isFinite(parsed.avgMs) ||
      !Number.isFinite(parsed.maxMs)
    ) {
      continue;
    }

    metrics.push(parsed);
  }
  return metrics;
}

export function evaluatePerfBudgets(metrics: MediaSearchQueryMetrics[], options: PerfGateOptions): string[] {
  const violations: string[] = [];

  for (const metric of metrics) {
    if (metric.p95Ms > options.p95BudgetMs) {
      violations.push(
        `${metric.name}: p95=${metric.p95Ms.toFixed(2)}ms exceeds budget ${options.p95BudgetMs.toFixed(2)}ms`
      );
    }
    if (metric.avgMs > options.avgBudgetMs) {
      violations.push(
        `${metric.name}: avg=${metric.avgMs.toFixed(2)}ms exceeds budget ${options.avgBudgetMs.toFixed(2)}ms`
      );
    }
  }

  return violations;
}
