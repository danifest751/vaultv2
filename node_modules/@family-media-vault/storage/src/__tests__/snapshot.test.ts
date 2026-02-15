import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSnapshotPointer, readSnapshotRecords, writeSnapshot } from "../snapshot";

describe("snapshot", () => {
  it("writes pointer and reads records", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-snap-"));
    const snapshotsDir = path.join(baseDir, "snapshots");

    const records = [
      { kind: "source", sourceId: "src_1" },
      { kind: "media", mediaId: "med_1" }
    ];

    const pointer = await writeSnapshot({
      snapshotsDir,
      walSeq: 10,
      records
    });

    const loadedPointer = await readSnapshotPointer(snapshotsDir);
    expect(loadedPointer.snapshotFile).toBe(pointer.snapshotFile);
    expect(loadedPointer.walSeq).toBe(10);

    const loadedRecords: Array<{ kind: string; sourceId?: string; mediaId?: string }> = [];
    for await (const record of readSnapshotRecords(snapshotsDir, pointer.snapshotFile)) {
      loadedRecords.push(record);
    }

    expect(loadedRecords).toEqual(records);
  });
});
