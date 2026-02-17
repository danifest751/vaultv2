import { mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pruneSnapshots } from "../snapshot-retention";

describe("snapshot retention", () => {
  it("keeps newest snapshots and preserves current pointer target", async () => {
    const snapshotsDir = await mkdtemp(path.join(tmpdir(), "fmv-snap-retain-"));

    const oldA = "snapshot-100-a.ndjson";
    const oldB = "snapshot-200-b.ndjson";
    const newest = "snapshot-300-c.ndjson";

    await writeFile(path.join(snapshotsDir, oldA), "{}\n", "utf8");
    await writeFile(path.join(snapshotsDir, oldB), "{}\n", "utf8");
    await writeFile(path.join(snapshotsDir, newest), "{}\n", "utf8");

    const now = Date.now() / 1000;
    await utimes(path.join(snapshotsDir, oldA), now - 10, now - 10);
    await utimes(path.join(snapshotsDir, oldB), now - 5, now - 5);
    await utimes(path.join(snapshotsDir, newest), now, now);

    await pruneSnapshots(snapshotsDir, 1, oldB);

    const entries = await readdir(snapshotsDir);
    expect(entries).toContain(oldB);
    expect(entries).toContain(newest);
    expect(entries).not.toContain(oldA);
  });
});
