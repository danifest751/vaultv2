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
    const mediaId = newMediaId();

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

    await writer.append(mediaImported);
    state.applyEvent(mediaImported);

    await writer.close();

    const rebuilt = await rebuildDomainState({ walDir, snapshotsDir, hmacSecret });

    expect(rebuilt.sources.listSources()).toHaveLength(1);
    expect(rebuilt.sources.listEntries()).toHaveLength(1);
    expect(rebuilt.media.list()).toHaveLength(1);
    expect(rebuilt.media.get(mediaId)).toBeDefined();
  });
});
