import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEvent, newMediaId, newSourceEntryId, newSourceId } from "@family-media-vault/core";
import {
  DomainState,
  DerivedLayout,
  VaultLayout,
  derivedPathForMedia,
  ensureMediaStored
} from "@family-media-vault/storage";
import { createDerivedGenerateJobHandler } from "../derived";
import { createMetadataJobHandler } from "../metadata";

describe("metadata + derived jobs", () => {
  it("normalizes exif metadata and enqueues derived thumb", async () => {
    const state = new DomainState();
    const sourceId = newSourceId();
    const sourceEntryId = newSourceEntryId();
    const mediaId = newMediaId();
    const filePath = "C:/media/photo.jpg";
    const appended: Array<ReturnType<typeof createEvent>> = [];
    const enqueued: Array<{ kind: string; payload?: Record<string, unknown> }> = [];

    state.applyEvent(
      createEvent("SOURCE_CREATED", {
        source: {
          sourceId,
          path: "C:/media",
          recursive: true,
          includeArchives: false,
          excludeGlobs: [],
          createdAt: 1
        }
      })
    );
    state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId,
          sourceId,
          kind: "file",
          path: filePath,
          size: 123,
          mtimeMs: 1700000000000,
          fingerprint: "123:1700000000000:abc",
          lastSeenAt: 1700000000000,
          state: "active"
        }
      })
    );
    state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId,
          sha256: "a".repeat(64),
          size: 123,
          sourceEntryId
        }
      })
    );

    const handler = createMetadataJobHandler({
      state,
      appendEvent: async (event) => {
        appended.push(event);
        state.applyEvent(event);
      },
      commandRunner: {
        run: async () => ({
          stdout: JSON.stringify([
            {
              ImageWidth: 1920,
              ImageHeight: 1080,
              Model: "Canon X",
              DateTimeOriginal: "2024:01:02 03:04:05",
              MIMEType: "image/jpeg"
            }
          ]),
          stderr: ""
        })
      },
      jobEngine: {
        enqueue: async (kind, payload) => {
          enqueued.push({ kind, payload: payload as Record<string, unknown> | undefined });
          return "job_test" as never;
        }
      }
    });

    await handler({ payload: { mediaId, sourceEntryId } });

    const metadata = state.metadata.get(mediaId);
    expect(metadata?.kind).toBe("photo");
    expect(metadata?.width).toBe(1920);
    expect(metadata?.height).toBe(1080);
    expect(metadata?.cameraModel).toBe("Canon X");
    expect(metadata?.mimeType).toBe("image/jpeg");
    expect(typeof metadata?.takenAt).toBe("number");
    expect(appended.some((event) => event.type === "MEDIA_METADATA_EXTRACTED")).toBe(true);
    expect(enqueued).toEqual([
      {
        kind: "derived:generate",
        payload: { mediaId, kind: "thumb" }
      }
    ]);
  });

  it("derived job is idempotent and skips regeneration when file already exists", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-derived-"));
    const sourceDir = path.join(baseDir, "source");
    const vaultDir = path.join(baseDir, "vault");
    const derivedDir = path.join(baseDir, "derived");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "a.jpg"), "image-data");

    const state = new DomainState();
    const sourceId = newSourceId();
    const sourceEntryId = newSourceEntryId();
    const mediaId = newMediaId();
    const sourcePath = path.join(sourceDir, "a.jpg");

    state.applyEvent(
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
    state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId,
          sourceId,
          kind: "file",
          path: sourcePath,
          size: 9,
          mtimeMs: Date.now(),
          fingerprint: "9:1:head",
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );

    const sha256 = "b".repeat(64);
    await ensureMediaStored({ root: vaultDir }, sourcePath, sha256);

    state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media: {
          mediaId,
          sha256,
          size: 9,
          sourceEntryId
        }
      })
    );
    state.applyEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId,
        sourceEntryId,
        metadata: {
          kind: "photo",
          mimeType: "image/jpeg"
        }
      })
    );

    const vault: VaultLayout = { root: vaultDir };
    const derived: DerivedLayout = { root: derivedDir };
    let runCount = 0;

    const handler = createDerivedGenerateJobHandler({
      state,
      vault,
      derived,
      commandRunner: {
        run: async (_command, args) => {
          runCount += 1;
          const outputPath = args[args.length - 1];
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(outputPath, "derived");
          return { stdout: "", stderr: "" };
        }
      }
    });

    await handler({ payload: { mediaId, kind: "thumb" } });
    await handler({ payload: { mediaId, kind: "thumb" } });

    const outputPath = derivedPathForMedia(derived, mediaId, "thumb");
    expect(runCount).toBe(1);
    const file = await readFile(outputPath, "utf8");
    expect(file).toBe("derived");
  });
});
