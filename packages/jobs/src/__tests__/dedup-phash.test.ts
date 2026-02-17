import { describe, expect, it } from "vitest";
import {
  createEvent,
  newMediaId,
  newSourceEntryId,
  newSourceId
} from "@family-media-vault/core";
import { DomainState } from "@family-media-vault/storage";
import { createProbableDedupJobHandler } from "../dedup";

describe("probable dedup perceptual hash filtering", () => {
  it("respects custom strong/probable thresholds", async () => {
    const state = new DomainState();
    const sourceId = newSourceId();
    const entryA = newSourceEntryId();
    const entryB = newSourceEntryId();
    const mediaA = newMediaId();
    const mediaB = newMediaId();

    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      state.applyEvent(event);
    };

    await appendEvent(
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
    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryA,
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
    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryB,
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
    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaA, sha256: "1".repeat(64), size: 100, sourceEntryId: entryA }
      })
    );
    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaB, sha256: "2".repeat(64), size: 100, sourceEntryId: entryB }
      })
    );
    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaA,
        sourceEntryId: entryA,
        metadata: { kind: "photo", raw: { perceptualHash: "abcdef0000000000" } }
      })
    );
    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaB,
        sourceEntryId: entryB,
        metadata: { kind: "photo", raw: { perceptualHash: "abcdef0000000001" } }
      })
    );

    const handler = createProbableDedupJobHandler({
      state,
      appendEvent,
      now: () => 111,
      strongDistanceThreshold: 0,
      probableDistanceThreshold: 2
    });
    await handler({ payload: { sourceEntryId: entryA } });

    expect(state.duplicateLinks.list().filter((link) => link.level === "strong")).toHaveLength(0);
    expect(state.quarantine.list()).toHaveLength(1);
  });

  it("creates strong duplicate link and skips quarantine for very close perceptual hashes", async () => {
    const state = new DomainState();
    const sourceId = newSourceId();
    const entryA = newSourceEntryId();
    const entryB = newSourceEntryId();
    const mediaA = newMediaId();
    const mediaB = newMediaId();

    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      state.applyEvent(event);
    };

    await appendEvent(
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

    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryA,
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
    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryB,
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

    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaA, sha256: "9".repeat(64), size: 100, sourceEntryId: entryA }
      })
    );
    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaB, sha256: "8".repeat(64), size: 100, sourceEntryId: entryB }
      })
    );

    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaA,
        sourceEntryId: entryA,
        metadata: { kind: "photo", raw: { perceptualHash: "abcdef0000000000" } }
      })
    );
    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaB,
        sourceEntryId: entryB,
        metadata: { kind: "photo", raw: { perceptualHash: "abcdef0000000001" } }
      })
    );

    const handler = createProbableDedupJobHandler({ state, appendEvent, now: () => 789 });
    await handler({ payload: { sourceEntryId: entryA } });
    await handler({ payload: { sourceEntryId: entryA } });

    expect(state.quarantine.list()).toHaveLength(0);
    const strongLinks = state.duplicateLinks
      .list()
      .filter((link) => link.level === "strong" && link.sourceEntryId === entryA);
    expect(strongLinks).toHaveLength(1);
    expect(strongLinks[0].mediaId).toBe(mediaB);
  });

  it("creates quarantine using perceptual index even when head-hash differs", async () => {
    const state = new DomainState();
    const sourceId = newSourceId();
    const entryA = newSourceEntryId();
    const entryB = newSourceEntryId();
    const mediaA = newMediaId();
    const mediaB = newMediaId();

    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      state.applyEvent(event);
    };

    await appendEvent(
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

    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryA,
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
    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryB,
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

    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaA, sha256: "e".repeat(64), size: 100, sourceEntryId: entryA }
      })
    );
    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaB, sha256: "f".repeat(64), size: 100, sourceEntryId: entryB }
      })
    );

    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaA,
        sourceEntryId: entryA,
        metadata: { kind: "photo", raw: { perceptualHash: "1234000000000000" } }
      })
    );
    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaB,
        sourceEntryId: entryB,
        metadata: { kind: "photo", raw: { perceptualHash: "12340000000000ff" } }
      })
    );

    const handler = createProbableDedupJobHandler({ state, appendEvent, now: () => 456 });
    await handler({ payload: { sourceEntryId: entryA } });

    const items = state.quarantine.list();
    expect(items).toHaveLength(1);
    expect(new Set(items[0].candidateMediaIds)).toEqual(new Set([mediaA, mediaB]));
  });

  it("does not create quarantine when perceptual hashes are far apart", async () => {
    const state = new DomainState();
    const sourceId = newSourceId();
    const entryA = newSourceEntryId();
    const entryB = newSourceEntryId();
    const mediaA = newMediaId();
    const mediaB = newMediaId();

    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      state.applyEvent(event);
    };

    await appendEvent(
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

    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryA,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 100,
          mtimeMs: 1,
          fingerprint: "100:1:head-same",
          lastSeenAt: 1,
          state: "active"
        }
      })
    );
    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryB,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/b.jpg",
          size: 100,
          mtimeMs: 1,
          fingerprint: "100:1:head-same",
          lastSeenAt: 1,
          state: "active"
        }
      })
    );

    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaA, sha256: "a".repeat(64), size: 100, sourceEntryId: entryA }
      })
    );
    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaB, sha256: "b".repeat(64), size: 100, sourceEntryId: entryB }
      })
    );

    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaA,
        sourceEntryId: entryA,
        metadata: { kind: "photo", raw: { perceptualHash: "0000000000000000" } }
      })
    );
    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaB,
        sourceEntryId: entryB,
        metadata: { kind: "photo", raw: { perceptualHash: "ffffffffffffffff" } }
      })
    );

    const handler = createProbableDedupJobHandler({ state, appendEvent, now: () => 123 });
    await handler({ payload: { sourceEntryId: entryA } });

    expect(state.quarantine.list()).toHaveLength(0);
  });

  it("creates quarantine when perceptual hashes are similar", async () => {
    const state = new DomainState();
    const sourceId = newSourceId();
    const entryA = newSourceEntryId();
    const entryB = newSourceEntryId();
    const mediaA = newMediaId();
    const mediaB = newMediaId();

    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      state.applyEvent(event);
    };

    await appendEvent(
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

    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryA,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/a.jpg",
          size: 100,
          mtimeMs: 1,
          fingerprint: "100:1:head-same",
          lastSeenAt: 1,
          state: "active"
        }
      })
    );
    await appendEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entryB,
          sourceId,
          kind: "file",
          path: "C:/tmp/source/b.jpg",
          size: 100,
          mtimeMs: 1,
          fingerprint: "100:1:head-same",
          lastSeenAt: 1,
          state: "active"
        }
      })
    );

    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaA, sha256: "c".repeat(64), size: 100, sourceEntryId: entryA }
      })
    );
    await appendEvent(
      createEvent("MEDIA_IMPORTED", {
        media: { mediaId: mediaB, sha256: "d".repeat(64), size: 100, sourceEntryId: entryB }
      })
    );

    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaA,
        sourceEntryId: entryA,
        metadata: { kind: "photo", raw: { perceptualHash: "00000000000000ff" } }
      })
    );
    await appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId: mediaB,
        sourceEntryId: entryB,
        metadata: { kind: "photo", raw: { perceptualHash: "00000000000000e0" } }
      })
    );

    const handler = createProbableDedupJobHandler({ state, appendEvent, now: () => 321 });
    await handler({ payload: { sourceEntryId: entryA } });

    const items = state.quarantine.list();
    expect(items).toHaveLength(1);
    expect(new Set(items[0].candidateMediaIds)).toEqual(new Set([mediaA, mediaB]));
  });
});
