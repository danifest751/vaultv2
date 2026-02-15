import { createHmac } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DomainEvent } from "@family-media-vault/core";
import { ensureDir, stableStringify } from "./utils";

export const WAL_SCHEMA_VERSION = 1;

export interface WalRecord {
  schemaVersion: number;
  seq: number;
  ts: number;
  event: DomainEvent;
  prevHash: string | null;
  hash: string;
}

export interface WalOptions {
  walDir: string;
  hmacSecret: string | Buffer;
  maxSegmentBytes?: number;
  fsync?: boolean;
}

export interface ReadWalOptions {
  walDir: string;
  hmacSecret: string | Buffer;
  verify?: boolean;
}

export class WalIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalIntegrityError";
  }
}

const WAL_SEGMENT_REGEX = /^\d{6}\.jsonl$/;
const DEFAULT_MAX_SEGMENT_BYTES = 256 * 1024 * 1024;

function segmentFileName(segmentId: number): string {
  return `${segmentId.toString().padStart(6, "0")}.jsonl`;
}

function segmentPath(walDir: string, segmentId: number): string {
  return path.join(walDir, segmentFileName(segmentId));
}

async function listSegments(walDir: string): Promise<number[]> {
  const entries = await fs.readdir(walDir).catch(() => [] as string[]);
  return entries
    .filter((name) => WAL_SEGMENT_REGEX.test(name))
    .map((name) => Number(name.replace(".jsonl", "")))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
}

function computeWalHash(
  record: Omit<WalRecord, "hash">,
  secret: string | Buffer
): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(stableStringify(record));
  return hmac.digest("hex");
}

async function readLastRecord(filePath: string): Promise<WalRecord | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || stat.size === 0) {
    return null;
  }

  const readSize = Math.min(stat.size, 64 * 1024);
  const handle = await fs.open(filePath, "r");
  const buffer = Buffer.alloc(readSize);
  await handle.read(buffer, 0, readSize, stat.size - readSize);
  await handle.close();

  const chunk = buffer.toString("utf8").trim();
  if (chunk.length === 0) {
    return null;
  }
  const lines = chunk.split("\n");
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    return null;
  }
  return JSON.parse(lastLine) as WalRecord;
}

export class WalWriter {
  private readonly walDir: string;
  private readonly hmacSecret: string | Buffer;
  private readonly maxSegmentBytes: number;
  private readonly fsync: boolean;
  private currentSegmentId: number;
  private currentPath: string;
  private currentSize: number;
  private lastSeq: number;
  private lastHash: string | null;
  private handle: fs.FileHandle;

  private constructor(options: WalOptions, state: WalWriterState) {
    this.walDir = options.walDir;
    this.hmacSecret = options.hmacSecret;
    this.maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    this.fsync = options.fsync ?? true;
    this.currentSegmentId = state.currentSegmentId;
    this.currentPath = state.currentPath;
    this.currentSize = state.currentSize;
    this.lastSeq = state.lastSeq;
    this.lastHash = state.lastHash;
    this.handle = state.handle;
  }

  static async create(options: WalOptions): Promise<WalWriter> {
    await ensureDir(options.walDir);
    const segments = await listSegments(options.walDir);
    const lastSegment = segments[segments.length - 1];
    let currentSegmentId = lastSegment ?? 1;
    let currentPath = segmentPath(options.walDir, currentSegmentId);

    let lastSeq = 0;
    let lastHash: string | null = null;
    let currentSize = 0;

    if (segments.length > 0) {
      const lastRecord = await readLastRecord(currentPath);
      if (lastRecord) {
        lastSeq = lastRecord.seq;
        lastHash = lastRecord.hash;
      }
      const stat = await fs.stat(currentPath);
      currentSize = stat.size;
    }

    const maxBytes = options.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES;
    if (currentSize >= maxBytes) {
      currentSegmentId += 1;
      currentPath = segmentPath(options.walDir, currentSegmentId);
      currentSize = 0;
    }

    const handle = await fs.open(currentPath, "a");

    return new WalWriter(options, {
      currentSegmentId,
      currentPath,
      currentSize,
      lastSeq,
      lastHash,
      handle
    });
  }

  async append(event: DomainEvent): Promise<WalRecord> {
    const recordBase = {
      schemaVersion: WAL_SCHEMA_VERSION,
      seq: this.lastSeq + 1,
      ts: Date.now(),
      event,
      prevHash: this.lastHash
    };

    const hash = computeWalHash(recordBase, this.hmacSecret);
    const record: WalRecord = { ...recordBase, hash };
    const line = `${JSON.stringify(record)}\n`;

    await this.handle.write(line, undefined, "utf8");
    if (this.fsync) {
      await this.handle.sync();
    }

    this.currentSize += Buffer.byteLength(line);
    this.lastSeq = record.seq;
    this.lastHash = record.hash;

    if (this.currentSize >= this.maxSegmentBytes) {
      await this.rotate();
    }

    return record;
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  private async rotate(): Promise<void> {
    await this.handle.close();
    this.currentSegmentId += 1;
    this.currentPath = segmentPath(this.walDir, this.currentSegmentId);
    this.currentSize = 0;
    this.handle = await fs.open(this.currentPath, "a");
  }
}

interface WalWriterState {
  currentSegmentId: number;
  currentPath: string;
  currentSize: number;
  lastSeq: number;
  lastHash: string | null;
  handle: fs.FileHandle;
}

export async function* readWalRecords(options: ReadWalOptions): AsyncGenerator<WalRecord> {
  const segments = await listSegments(options.walDir);
  let expectedSeq = 1;
  let expectedPrevHash: string | null = null;

  for (const segmentId of segments) {
    const filePath = segmentPath(options.walDir, segmentId);
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      const record = JSON.parse(line) as WalRecord;

      if (options.verify !== false) {
        verifyRecord(record, expectedSeq, expectedPrevHash, options.hmacSecret);
      }

      expectedSeq = record.seq + 1;
      expectedPrevHash = record.hash;
      yield record;
    }
  }
}

function verifyRecord(
  record: WalRecord,
  expectedSeq: number,
  expectedPrevHash: string | null,
  secret: string | Buffer
): void {
  if (record.schemaVersion !== WAL_SCHEMA_VERSION) {
    throw new WalIntegrityError(`Unsupported WAL schema: ${record.schemaVersion}`);
  }

  if (record.seq !== expectedSeq) {
    throw new WalIntegrityError(`Unexpected WAL sequence: ${record.seq} (expected ${expectedSeq})`);
  }

  if (record.prevHash !== expectedPrevHash) {
    throw new WalIntegrityError("WAL hash chain mismatch");
  }

  const computed = computeWalHash(
    {
      schemaVersion: record.schemaVersion,
      seq: record.seq,
      ts: record.ts,
      event: record.event,
      prevHash: record.prevHash
    },
    secret
  );

  if (record.hash !== computed) {
    throw new WalIntegrityError("WAL record hash mismatch");
  }
}
