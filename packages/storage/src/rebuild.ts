import path from "node:path";
import { promises as fs } from "node:fs";
import { DomainState } from "./state";
import { readWalRecords } from "./wal";
import { readSnapshotPointer, readSnapshotRecords } from "./snapshot";
import { rebuildDomainStateFromSnapshot, DomainSnapshotRecord } from "./state-snapshot";

export interface RebuildStateOptions {
  walDir: string;
  snapshotsDir?: string;
  hmacSecret: string | Buffer;
  verifyWal?: boolean;
}

export async function rebuildDomainState(options: RebuildStateOptions): Promise<DomainState> {
  let state = new DomainState();
  let startSeq = 0;

  if (options.snapshotsDir) {
    const pointer = await readSnapshotPointerIfExists(options.snapshotsDir);
    if (pointer) {
      const records = readSnapshotRecords<DomainSnapshotRecord>(
        options.snapshotsDir,
        pointer.snapshotFile
      );
      state = await rebuildDomainStateFromSnapshot(records);
      startSeq = pointer.walSeq;
    }
  }

  for await (const record of readWalRecords({
    walDir: options.walDir,
    hmacSecret: options.hmacSecret,
    verify: options.verifyWal
  })) {
    if (record.seq <= startSeq) {
      continue;
    }
    state.applyEvent(record.event);
  }

  return state;
}

async function readSnapshotPointerIfExists(snapshotsDir: string) {
  const pointerPath = path.join(snapshotsDir, "pointer.json");
  try {
    await fs.access(pointerPath);
  } catch {
    return null;
  }
  return readSnapshotPointer(snapshotsDir);
}
