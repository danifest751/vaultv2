import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEvent,
  newSourceEntryId,
  newSourceId
} from "@family-media-vault/core";
import { WalIntegrityError, WalWriter, readWalRecords } from "../wal";

const HMAC_SECRET = "test-secret";

describe("WalWriter", () => {
  it("appends records and verifies hash chain", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-wal-"));
    const walDir = path.join(baseDir, "wal");

    const writer = await WalWriter.create({ walDir, hmacSecret: HMAC_SECRET });

    const sourceId = newSourceId();
    const entryId = newSourceEntryId();

    await writer.append(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: "/photos",
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: Date.now()
        }
      })
    );

    await writer.append(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryId,
          sourceId,
          kind: "file",
          path: "/photos/one.jpg",
          size: 123,
          mtimeMs: Date.now(),
          fingerprint: "fp:123",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );

    await writer.close();

    const records = [] as unknown[];
    for await (const record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
      records.push(record);
    }

    expect(records).toHaveLength(2);
  });

  it("detects tampering", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-wal-tamper-"));
    const walDir = path.join(baseDir, "wal");

    const writer = await WalWriter.create({ walDir, hmacSecret: HMAC_SECRET });
    const sourceId = newSourceId();

    await writer.append(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: "/photos",
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: Date.now()
        }
      })
    );

    await writer.close();

    const files = await readdir(walDir);
    const segment = files.find((name) => name.endsWith(".jsonl"));
    if (!segment) {
      throw new Error("WAL segment not found");
    }

    const segmentPath = path.join(walDir, segment);
    const content = await readFile(segmentPath, "utf8");
    const lines = content.trim().split("\n");
    const first = JSON.parse(lines[0]);
    first.event.type = "SOURCE_UPDATED";
    lines[0] = JSON.stringify(first);
    await writeFile(segmentPath, `${lines.join("\n")}\n`, "utf8");

    const readAll = async () => {
      for await (const _record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
        void _record;
      }
    };

    await expect(readAll()).rejects.toBeInstanceOf(WalIntegrityError);
  });
});
