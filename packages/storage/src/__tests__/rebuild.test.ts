import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEvent,
  newMediaId,
  newSourceEntryId,
  newSourceId
} from "@family-media-vault/core";
import {
  DomainState,
  rebuildDomainState,
  snapshotDomainState,
  WalWriter,
  writeSnapshot
} from "@family-media-vault/storage";

describe("rebuildDomainState", () => {
  it("rebuilds from snapshot and replays WAL tail", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-rebuild-"));
    const walDir = path.join(baseDir, "wal");
    const snapshotsDir = path.join(baseDir, "snapshots");

    const hmacSecret = "rebuild-secret";
    const writer = await WalWriter.create({ walDir, hmacSecret, fsync: false });

    const state = new DomainState();
    const sourceId = newSourceId();
    const entryId = newSourceEntryId();
    const entryIdB = newSourceEntryId();
    const mediaId = newMediaId();
    const mediaIdB = newMediaId();

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

    const entryUpserted = createEvent("SOURCE_ENTRY_UPSERTED", {
      entry: {
        sourceEntryId: entryId,
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

    const entryUpsertedB = createEvent("SOURCE_ENTRY_UPSERTED", {
      entry: {
        sourceEntryId: entryIdB,
        sourceId,
        kind: "file",
        path: "/source/b.jpg",
        size: 11,
        mtimeMs: 3,
        fingerprint: "fp-b",
        lastSeenAt: 4,
        state: "active"
      }
    });

    for (const event of [sourceCreated, entryUpserted]) {
      await writer.append(event);
      state.applyEvent(event);
    }

    await writeSnapshot({
      snapshotsDir,
      walSeq: 2,
      records: snapshotDomainState(state)
    });

    const mediaImported = createEvent("MEDIA_IMPORTED", {
      media: {
        mediaId,
        sha256: "sha256-a",
        size: 10,
        sourceEntryId: entryId
      }
    });

    const metadataExtractedA = createEvent("MEDIA_METADATA_EXTRACTED", {
      mediaId,
      sourceEntryId: entryId,
      metadata: {
        kind: "photo",
        cameraModel: "Canon EOS R6",
        takenAt: Date.parse("2024-01-02T10:11:12.000Z"),
        raw: {
          perceptualHash: "abcdefff00000000",
          gpsLatitude: 55.751,
          gpsLongitude: 37.617
        }
      }
    });

    const mediaImportedB = createEvent("MEDIA_IMPORTED", {
      media: {
        mediaId: mediaIdB,
        sha256: "sha256-b",
        size: 11,
        sourceEntryId: entryIdB
      }
    });

    const metadataExtractedB = createEvent("MEDIA_METADATA_EXTRACTED", {
      mediaId: mediaIdB,
      sourceEntryId: entryIdB,
      metadata: {
        kind: "photo",
        cameraModel: "Sony A7",
        takenAt: Date.parse("2024-01-03T10:11:12.000Z"),
        raw: { perceptualHash: "abcdefff000000ff" }
      }
    });

    for (const event of [entryUpsertedB, mediaImported, metadataExtractedA, mediaImportedB, metadataExtractedB]) {
      await writer.append(event);
      state.applyEvent(event);
    }

    await writer.close();

    const rebuilt = await rebuildDomainState({ walDir, snapshotsDir, hmacSecret });

    expect(rebuilt.sources.listSources()).toHaveLength(1);
    expect(rebuilt.sources.listEntries()).toHaveLength(2);
    expect(rebuilt.media.list()).toHaveLength(2);
    expect(rebuilt.media.get(mediaId)).toBeDefined();
    expect(rebuilt.metadata.getPerceptualHash(mediaId)).toBe("abcdefff00000000");
    expect(rebuilt.metadata.getPerceptualHash(mediaIdB)).toBe("abcdefff000000ff");
    expect(new Set(rebuilt.metadata.listMediaIdsByPerceptualHashPrefix("abcdefff00000000"))).toEqual(
      new Set([mediaId, mediaIdB])
    );
    expect(new Set(rebuilt.mediaSearch.query({ kind: "photo" }, rebuilt))).toEqual(new Set([mediaId, mediaIdB]));
    expect(new Set(rebuilt.mediaSearch.query({ sourceId }, rebuilt))).toEqual(new Set([mediaId, mediaIdB]));
    expect(new Set(rebuilt.mediaSearch.query({ cameraModel: "canon eos r6" }, rebuilt))).toEqual(new Set([mediaId]));
    expect(new Set(rebuilt.mediaSearch.query({ takenDay: "2024-01-02" }, rebuilt))).toEqual(new Set([mediaId]));
    expect(new Set(rebuilt.mediaSearch.query({ gpsTile: "55.7:37.6" }, rebuilt))).toEqual(new Set([mediaId]));
  });
});
