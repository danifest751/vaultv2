import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEvent, newMediaId, newSourceEntryId, newSourceId } from "@family-media-vault/core";
import { readWalRecords } from "@family-media-vault/storage";
import { bootstrapServerRuntime } from "../bootstrap";

describe("bootstrapServerRuntime", () => {
  it("applies configured derived max attempts to derived:generate jobs", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-bootstrap-"));
    const walDir = path.join(baseDir, "wal");
    const snapshotsDir = path.join(baseDir, "snapshots");
    const vaultDir = path.join(baseDir, "vault");
    const derivedDir = path.join(baseDir, "derived");
    const hmacSecret = "bootstrap-secret";

    const runtime = await bootstrapServerRuntime({
      walDir,
      snapshotsDir,
      vaultDir,
      derivedDir,
      hmacSecret,
      jobConcurrencyTotal: 2,
      jobConcurrencyIo: 1,
      jobConcurrencyCpu: 1,
      jobConcurrencyControl: 1,
      derivedGenerateMaxAttempts: 2,
      dedupStrongDistanceThreshold: 4,
      dedupProbableDistanceThreshold: 10
    });

    await runtime.jobEngine.enqueue("derived:generate", {
      mediaId: newMediaId(),
      kind: "thumb"
    });
    await runtime.jobEngine.runUntilIdle();

    const [job] = runtime.jobStore.list();
    expect(job).toBeDefined();
    expect(job?.kind).toBe("derived:generate");
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(2);
    expect(job?.lastError).toContain("Media not found");

    const eventTypes: string[] = [];
    for await (const record of readWalRecords({ walDir, hmacSecret })) {
      eventTypes.push(record.event.type);
    }

    expect(eventTypes.filter((type) => type === "JOB_RETRY_SCHEDULED")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "JOB_STARTED")).toHaveLength(2);
  });

  it("applies dedup strong/probable thresholds from runtime bootstrap", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-bootstrap-dedup-"));
    const walDir = path.join(baseDir, "wal");
    const snapshotsDir = path.join(baseDir, "snapshots");
    const vaultDir = path.join(baseDir, "vault");
    const derivedDir = path.join(baseDir, "derived");
    const hmacSecret = "bootstrap-dedup-secret";

    const runtime = await bootstrapServerRuntime({
      walDir,
      snapshotsDir,
      vaultDir,
      derivedDir,
      hmacSecret,
      jobConcurrencyTotal: 2,
      jobConcurrencyIo: 1,
      jobConcurrencyCpu: 1,
      jobConcurrencyControl: 1,
      derivedGenerateMaxAttempts: 2,
      dedupStrongDistanceThreshold: 0,
      dedupProbableDistanceThreshold: 2
    });

    const sourceId = newSourceId();
    const sourceEntryIdA = newSourceEntryId();
    const sourceEntryIdB = newSourceEntryId();
    const mediaIdA = newMediaId();
    const mediaIdB = newMediaId();

    await runtime.appendEvent(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: "C:/tmp/source",
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: 1
        }
      })
    );
    await runtime.appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: sourceEntryIdA,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 100,
          mtimeMs: 1,
          fingerprint: "100:1:head-a",
          lastSeenAt: 1,
          state: "active"
        }
      })
    );
    await runtime.appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: sourceEntryIdB,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/b.jpg",
          size: 100,
          mtimeMs: 1,
          fingerprint: "100:1:head-b",
          lastSeenAt: 1,
          state: "active"
        }
      })
    );
    await runtime.appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaIdA, sha256: "1".repeat(64), size: 100, sourceEntryId: sourceEntryIdA }
      })
    );
    await runtime.appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaIdB, sha256: "2".repeat(64), size: 100, sourceEntryId: sourceEntryIdB }
      })
    );
    await runtime.appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaIdA,
        sourceEntryId: sourceEntryIdA,
        metadata: { kind: "photo", raw: { perceptualHash: "abcdef0000000000" } }
      })
    );
    await runtime.appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaIdB,
        sourceEntryId: sourceEntryIdB,
        metadata: { kind: "photo", raw: { perceptualHash: "abcdef0000000001" } }
      })
    );

    await runtime.jobEngine.enqueue("dedup:probable", { sourceEntryId: sourceEntryIdA });
    await runtime.jobEngine.runUntilIdle();

    expect(runtime.state.quarantine.list()).toHaveLength(1);
    const strongLinks = runtime.state.duplicateLinks
      .list()
      .filter((link) => link.level === "strong" && link.sourceEntryId === sourceEntryIdA);
    expect(strongLinks).toHaveLength(0);
  });
});
