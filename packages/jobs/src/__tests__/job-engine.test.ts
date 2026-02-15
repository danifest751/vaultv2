import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWalRecords, WalWriter } from "@family-media-vault/storage";
import { JobEngine } from "../job-engine";
import { JobStore } from "../job-store";

const HMAC_SECRET = "job-secret";

describe("JobEngine", () => {
  it("runs queued jobs and writes WAL events", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-jobs-"));
    const walDir = path.join(baseDir, "wal");

    const writer = await WalWriter.create({ walDir, hmacSecret: HMAC_SECRET, fsync: false });
    const store = new JobStore();

    const engine = new JobEngine({
      store,
      eventWriter: {
        append: async (event) => {
          await writer.append(event);
        }
      },
      concurrency: 1
    });

    let handled = 0;

    engine.register({
      kind: "demo",
      handler: async () => {
        handled += 1;
      }
    });

    await engine.enqueue("demo", { hello: "world" });
    await engine.runUntilIdle();

    await writer.close();

    expect(handled).toBe(1);

    const job = store.list()[0];
    expect(job?.status).toBe("completed");

    const events: string[] = [];
    for await (const record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
      events.push(record.event.type);
    }

    expect(events).toEqual(["JOB_ENQUEUED", "JOB_STARTED", "JOB_COMPLETED"]);
  });
});
