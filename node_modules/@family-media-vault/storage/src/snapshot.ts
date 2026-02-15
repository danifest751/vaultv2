import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { ensureDir, toAsyncIterable } from "./utils";

export const SNAPSHOT_SCHEMA_VERSION = 1;

export interface SnapshotPointer {
  schemaVersion: number;
  createdAt: number;
  walSeq: number;
  snapshotFile: string;
  format: "ndjson";
}

export interface SnapshotWriteOptions<T> {
  snapshotsDir: string;
  walSeq: number;
  records: Iterable<T> | AsyncIterable<T>;
  snapshotFile?: string;
}

export async function writeSnapshot<T>(options: SnapshotWriteOptions<T>): Promise<SnapshotPointer> {
  await ensureDir(options.snapshotsDir);

  const snapshotFile =
    options.snapshotFile ?? `snapshot-${Date.now()}-${randomUUID()}.ndjson`;
  const filePath = path.join(options.snapshotsDir, snapshotFile);

  const handle = await fs.open(filePath, "w");
  try {
    for await (const record of toAsyncIterable(options.records)) {
      const line = `${JSON.stringify(record)}\n`;
      await handle.write(line, "utf8");
    }
  } finally {
    await handle.close();
  }

  const pointer: SnapshotPointer = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    createdAt: Date.now(),
    walSeq: options.walSeq,
    snapshotFile,
    format: "ndjson"
  };

  const pointerPath = path.join(options.snapshotsDir, "pointer.json");
  await fs.writeFile(pointerPath, JSON.stringify(pointer, null, 2), "utf8");
  return pointer;
}

export async function readSnapshotPointer(snapshotsDir: string): Promise<SnapshotPointer> {
  const pointerPath = path.join(snapshotsDir, "pointer.json");
  const raw = await fs.readFile(pointerPath, "utf8");
  return JSON.parse(raw) as SnapshotPointer;
}

export async function* readSnapshotRecords<T>(
  snapshotsDir: string,
  snapshotFile: string
): AsyncGenerator<T> {
  const filePath = path.join(snapshotsDir, snapshotFile);
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    yield JSON.parse(line) as T;
  }
}
