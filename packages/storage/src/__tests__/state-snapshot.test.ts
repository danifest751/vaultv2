import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEvent,
  newDuplicateLinkId,
  newMediaId,
  newQuarantineItemId,
  newSourceEntryId,
  newSourceId
} from "@family-media-vault/core";
import {
  DomainState,
  readSnapshotRecords,
  rebuildDomainStateFromSnapshot,
  snapshotDomainState,
  writeSnapshot
} from "@family-media-vault/storage";

describe("state snapshot", () => {
  it("roundtrips domain state through snapshot records", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-state-snap-"));
    const snapshotsDir = path.join(baseDir, "snapshots");

    const state = new DomainState();
    const sourceId = newSourceId();
    const entryIdA = newSourceEntryId();
    const entryIdB = newSourceEntryId();
    const mediaId = newMediaId();
    const quarantineId = newQuarantineItemId();
    const duplicateLinkId = newDuplicateLinkId();

    const sourceCreated = createEvent("SOURCE_CREATED", {
      source: {
        sourceId,
        path: "/source",
        recursive: true,
        includeArchives: false,
        excludeGlobs: [],
        createdAt: 1
      }
    });

    const entryA = createEvent("SOURCE_ENTRY_UPSERTED", {
      entry: {
        sourceEntryId: entryIdA,
        sourceId,
        kind: "file",
        path: "/source/a.jpg",
        size: 10,
        mtimeMs: 2,
        fingerprint: "fp-a",
        lastSeenAt: 3,
        state: "active"
      }
    });

    const entryB = createEvent("SOURCE_ENTRY_UPSERTED", {
      entry: {
        sourceEntryId: entryIdB,
        sourceId,
        kind: "file",
        path: "/source/b.jpg",
        size: 11,
        mtimeMs: 2,
        fingerprint: "fp-b",
        lastSeenAt: 3,
        state: "active"
      }
    });

    const mediaImported = createEvent("MEDIA_IMPORTED", {
      media: {
        mediaId,
        sha256: "sha256-a",
        size: 10,
        sourceEntryId: entryIdA
      }
    });

    const duplicateExact = createEvent("MEDIA_SKIPPED_DUPLICATE_EXACT", {
      sourceEntryId: entryIdB,
      existingMediaId: mediaId
    });

    const metadataExtracted = createEvent("MEDIA_METADATA_EXTRACTED", {
      mediaId,
      sourceEntryId: entryIdA,
      metadata: {
        kind: "photo",
        takenAt: 2,
        mimeType: "image/jpeg",
        raw: { ext: ".jpg" }
      }
    });

    const quarantineCreated = createEvent("QUARANTINE_CREATED", {
      item: {
        quarantineId,
        sourceEntryId: entryIdB,
        candidateMediaIds: [mediaId],
        status: "pending",
        createdAt: 4
      }
    });

    const quarantineAccepted = createEvent("QUARANTINE_ACCEPTED", {
      quarantineId,
      acceptedMediaId: mediaId,
      resolvedAt: 5
    });

    const duplicateLinkCreated = createEvent("DUPLICATE_LINK_CREATED", {
      link: {
        duplicateLinkId,
        mediaId,
        sourceEntryId: entryIdB,
        level: "probable",
        createdAt: 5,
        reason: "quarantine-accepted"
      }
    });

    for (const event of [
      sourceCreated,
      entryA,
      entryB,
      mediaImported,
      duplicateExact,
      metadataExtracted,
      quarantineCreated,
      quarantineAccepted,
      duplicateLinkCreated
    ]) {
      state.applyEvent(event);
    }

    const pointer = await writeSnapshot({
      snapshotsDir,
      walSeq: 10,
      records: snapshotDomainState(state)
    });

    const rebuilt = await rebuildDomainStateFromSnapshot(
      readSnapshotRecords(snapshotsDir, pointer.snapshotFile)
    );

    expect(rebuilt.sources.listSources()).toHaveLength(1);
    expect(rebuilt.sources.listEntries()).toHaveLength(2);
    expect(rebuilt.media.list()).toHaveLength(1);
    expect(rebuilt.ingest.getStatus(entryIdA).status).toBe("imported");
    expect(rebuilt.ingest.getStatus(entryIdB).status).toBe("duplicate");
    expect(rebuilt.metadata.get(mediaId)).toEqual({
      kind: "photo",
      takenAt: 2,
      mimeType: "image/jpeg",
      raw: { ext: ".jpg" }
    });
    const rebuiltQuarantine = rebuilt.quarantine.get(quarantineId);
    expect(rebuiltQuarantine?.status).toBe("accepted");
    expect(rebuiltQuarantine?.acceptedMediaId).toBe(mediaId);
    expect(rebuiltQuarantine?.resolvedAt).toBe(5);
    expect(rebuilt.duplicateLinks.list()).toHaveLength(1);
  });
});
