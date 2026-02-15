import { promises as fs } from "node:fs";

export async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

const OMIT = Symbol("omit");

function canonicalize(
  value: unknown,
  context: "root" | "array" | "object"
): unknown | typeof OMIT {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    if (context === "object") {
      return OMIT;
    }
    return null;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const mapped = canonicalize(item, "array");
      return mapped === OMIT ? null : mapped;
    });
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};

  for (const key of keys) {
    const mapped = canonicalize(record[key], "object");
    if (mapped !== OMIT) {
      result[key] = mapped;
    }
  }

  return result;
}

export function stableStringify(value: unknown): string {
  const canonical = canonicalize(value, "root");
  return JSON.stringify(canonical === OMIT ? null : canonical);
}

export async function* toAsyncIterable<T>(
  records: Iterable<T> | AsyncIterable<T>
): AsyncIterable<T> {
  if (Symbol.asyncIterator in records) {
    for await (const item of records as AsyncIterable<T>) {
      yield item;
    }
    return;
  }

  for (const item of records as Iterable<T>) {
    yield item;
  }
}
