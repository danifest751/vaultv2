import { promises as fs } from "node:fs";
import path from "node:path";

export async function pruneSnapshots(
  snapshotsDir: string,
  retentionMax: number,
  keepSnapshotFile: string
): Promise<void> {
  const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
  const snapshotFiles = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith("snapshot-") && entry.name.endsWith(".ndjson"))
    .map((entry) => entry.name);

  if (retentionMax <= 0) {
    await Promise.all(
      snapshotFiles
        .filter((file) => file !== keepSnapshotFile)
        .map((file) => fs.unlink(path.join(snapshotsDir, file)).catch(() => undefined))
    );
    return;
  }

  const snapshotStats = await Promise.all(
    snapshotFiles.map(async (file) => {
      const stat = await fs.stat(path.join(snapshotsDir, file));
      return { file, mtimeMs: stat.mtimeMs };
    })
  );
  snapshotStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const keep = new Set(snapshotStats.slice(0, retentionMax).map((item) => item.file));
  keep.add(keepSnapshotFile);

  await Promise.all(
    snapshotStats
      .filter((item) => !keep.has(item.file))
      .map((item) => fs.unlink(path.join(snapshotsDir, item.file)).catch(() => undefined))
  );
}
