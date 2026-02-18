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

  it("dedupes enqueue for same active kind+payload", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-jobs-dedup-"));
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
      kind: "derived:generate",
      handler: async () => {
        handled += 1;
      }
    });

    const payload = { mediaId: "med_1", kind: "thumb" };
    const jobId1 = await engine.enqueueDeduped("derived:generate", payload);
    const jobId2 = await engine.enqueueDeduped("derived:generate", payload);
    expect(jobId2).toBe(jobId1);

    await engine.runUntilIdle();
    await writer.close();

    expect(handled).toBe(1);
    expect(store.list().length).toBe(1);
  });

  it("retries failed job with backoff and completes on next attempt", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-jobs-retry-"));
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
      kind: "retry-demo",
      maxAttempts: 2,
      handler: async () => {
        handled += 1;
        if (handled === 1) {
          throw new Error("first_attempt_failed");
        }
      }
    });

    await engine.enqueue("retry-demo", { id: "a" });
    await engine.runUntilIdle();
    await writer.close();

    const job = store.list()[0];
    expect(job?.status).toBe("completed");
    expect(job?.attempts).toBe(2);
    expect(handled).toBe(2);

    const events: string[] = [];
    for await (const record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
      events.push(record.event.type);
    }
    expect(events).toContain("JOB_RETRY_SCHEDULED");
    expect(events.filter((type) => type === "JOB_STARTED")).toHaveLength(2);
  });

  it("marks job failed after max attempts exhausted", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-jobs-retry-fail-"));
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

    engine.register({
      kind: "retry-fail",
      maxAttempts: 2,
      handler: async () => {
        throw new Error("always_fails");
      }
    });

    await engine.enqueue("retry-fail", { id: "b" });
    await engine.runUntilIdle();
    await writer.close();

    const job = store.list()[0];
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(2);
    expect(job?.lastError).toBe("always_fails");

    const events: string[] = [];
    for await (const record of readWalRecords({ walDir, hmacSecret: HMAC_SECRET })) {
      events.push(record.event.type);
    }
    expect(events.filter((type) => type === "JOB_RETRY_SCHEDULED")).toHaveLength(1);
    expect(events.filter((type) => type === "JOB_FAILED")).toHaveLength(1);
  });

  it("enforces per-pool concurrency limits", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "fmv-jobs-pools-"));
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
      concurrency: 4,
      poolConcurrency: {
        io: 1,
        cpu: 2
      }
    });

    let ioActive = 0;
    let ioMaxActive = 0;
    let cpuActive = 0;
    let cpuMaxActive = 0;

    engine.register({
      kind: "io-job",
      pool: "io",
      handler: async () => {
        ioActive += 1;
        ioMaxActive = Math.max(ioMaxActive, ioActive);
        await sleep(25);
        ioActive -= 1;
      }
    });

    engine.register({
      kind: "cpu-job",
      pool: "cpu",
      handler: async () => {
        cpuActive += 1;
        cpuMaxActive = Math.max(cpuMaxActive, cpuActive);
        await sleep(25);
        cpuActive -= 1;
      }
    });

    await Promise.all([
      engine.enqueue("io-job"),
      engine.enqueue("io-job"),
      engine.enqueue("io-job"),
      engine.enqueue("cpu-job"),
      engine.enqueue("cpu-job"),
      engine.enqueue("cpu-job")
    ]);

    await engine.runUntilIdle();
    await writer.close();

    expect(ioMaxActive).toBeLessThanOrEqual(1);
    expect(cpuMaxActive).toBeLessThanOrEqual(2);
    expect(store.list().every((job) => job.status === "completed")).toBe(true);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
