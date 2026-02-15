import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEvent,
  newSourceId
} from "@family-media-vault/core";
import {
  DomainState,
  readWalRecords,
  WalWriter,
  VaultLayout
} from "@family-media-vault/storage";
import { JobEngine } from "../job-engine";
import { JobStore } from "../job-store";
import { createIngestJobHandler } from "../ingest";
import { createMetadataJobHandler } from "../metadata";
import { createScanJobHandler } from "../scan";

const HMAC_SECRET = "scan-secret";

describe("scan + ingest stage A/B", () => {
  it("scans incrementally and skips unchanged files", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-scan-"));
    const sourceDir = path.join(baseDir, "source");
    const vaultDir = path.join(baseDir, "vault");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "a.jpg"), "file-a");
    await writeFile(path.join(sourceDir, "b.jpg"), "file-b");

    const walDir = path.join(baseDir, "wal");
    const writer = await WalWriter.create({ walDir, hmacSecret: HMAC_SECRET, fsync: false });

    const state = new DomainState();
    const jobStore = new JobStore();

    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      await writer.append(event);
      state.applyEvent(event);
    };

    const jobEngine = new JobEngine({
      store: jobStore,
      eventWriter: { append: appendEvent },
      concurrency: 1
    });

    const vault: VaultLayout = { root: vaultDir };

    jobEngine.register({
      kind: "scan:source",
      handler: createScanJobHandler({
        state,
        appendEvent,
        jobEngine
      })
    });

    jobEngine.register({
      kind: "ingest:stage-a-b",
      handler: createIngestJobHandler({
        state,
        appendEvent,
        vault,
        jobEngine
      })
    });

    jobEngine.register({
      kind: "metadata:extract",
      handler: createMetadataJobHandler({
        state,
        appendEvent
      })
    });

    const sourceId = newSourceId();
    await appendEvent(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: sourceDir,
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: Date.now()
        }
      })
    );

    await jobEngine.enqueue("scan:source", { sourceId });
    await jobEngine.runUntilIdle();

    const mediaAfterFirst = state.media.list();
    expect(mediaAfterFirst).toHaveLength(2);
    const meta = state.metadata.get(mediaAfterFirst[0].mediaId);
    expect(meta?.kind).toBe("photo");

    const eventsFirst: string[] = [];
    for await (const record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
      eventsFirst.push(record.event.type);
    }

    await jobEngine.enqueue("scan:source", { sourceId });
    await jobEngine.runUntilIdle();

    const mediaAfterSecond = state.media.list();
    expect(mediaAfterSecond).toHaveLength(2);

    const eventsSecond: string[] = [];
    for await (const record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
      eventsSecond.push(record.event.type);
    }

    const firstIngestCount = eventsFirst.filter((e) => e === "MEDIA_IMPORTED").length;
    const secondIngestCount = eventsSecond.filter((e) => e === "MEDIA_IMPORTED").length;

    expect(secondIngestCount).toBe(firstIngestCount);

    await writer.close();
  });

  it("deduplicates exact duplicates", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-dedup-"));
    const sourceDir = path.join(baseDir, "source");
    const vaultDir = path.join(baseDir, "vault");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "a.jpg"), "same");
    await writeFile(path.join(sourceDir, "b.jpg"), "same");

    const walDir = path.join(baseDir, "wal");
    const writer = await WalWriter.create({ walDir, hmacSecret: HMAC_SECRET, fsync: false });

    const state = new DomainState();
    const jobStore = new JobStore();
    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      await writer.append(event);
      state.applyEvent(event);
    };

    const jobEngine = new JobEngine({
      store: jobStore,
      eventWriter: { append: appendEvent },
      concurrency: 1
    });

    const vault: VaultLayout = { root: vaultDir };

    jobEngine.register({
      kind: "scan:source",
      handler: createScanJobHandler({
        state,
        appendEvent,
        jobEngine
      })
    });

    jobEngine.register({
      kind: "ingest:stage-a-b",
      handler: createIngestJobHandler({
        state,
        appendEvent,
        vault,
        jobEngine
      })
    });

    jobEngine.register({
      kind: "metadata:extract",
      handler: createMetadataJobHandler({
        state,
        appendEvent
      })
    });

    const sourceId = newSourceId();
    await appendEvent(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: sourceDir,
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: Date.now()
        }
      })
    );

    await jobEngine.enqueue("scan:source", { sourceId });
    await jobEngine.runUntilIdle();

    expect(state.media.list()).toHaveLength(1);
    const onlyMedia = state.media.list()[0];
    const metadata = state.metadata.get(onlyMedia.mediaId);
    expect(metadata?.kind).toBe("photo");

    const events: string[] = [];
    for await (const record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
      events.push(record.event.type);
    }

    expect(events).toContain("MEDIA_SKIPPED_DUPLICATE_EXACT");
    expect(events).toContain("DUPLICATE_LINK_CREATED");

    await writer.close();
  });
});
