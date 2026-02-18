import { createEvent, DomainEvent, JobId, JsonObject, TimestampMs, newJobId } from "@family-media-vault/core";
import { JobStore } from "./job-store";

export interface JobHandlerContext {
  jobId: JobId;
  kind: string;
  payload?: JsonObject;
  attempt: number;
  startedAt: TimestampMs;
}

function computeRetryBackoffMs(attempt: number): number {
  const baseMs = 500;
  const backoff = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(backoff, 30_000);
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>;

export interface JobDefinition {
  kind: string;
  handler: JobHandler;
  maxAttempts?: number;
  pool?: string;
}

export interface JobEventWriter {
  append(event: DomainEvent): Promise<void>;
}

export interface JobEngineOptions {
  store: JobStore;
  eventWriter: JobEventWriter;
  concurrency?: number;
  poolConcurrency?: Record<string, number>;
  defaultPool?: string;
}

interface RegisteredJob {
  handler: JobHandler;
  maxAttempts: number;
  pool: string;
}

export class JobEngine {
  private readonly store: JobStore;
  private readonly eventWriter: JobEventWriter;
  private readonly concurrency: number;
  private readonly defaultPool: string;
  private readonly poolConcurrency = new Map<string, number>();
  private readonly registry = new Map<string, RegisteredJob>();
  private readonly queue: JobId[] = [];
  private readonly inflight = new Set<Promise<void>>();
  private readonly retryTimers = new Map<JobId, ReturnType<typeof setTimeout>>();
  private readonly activeCountByPool = new Map<string, number>();
  private activeCount = 0;

  constructor(options: JobEngineOptions) {
    this.store = options.store;
    this.eventWriter = options.eventWriter;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.defaultPool = normalizePoolName(options.defaultPool);

    if (options.poolConcurrency) {
      for (const [rawPool, rawLimit] of Object.entries(options.poolConcurrency)) {
        const pool = normalizePoolName(rawPool);
        const limit = Math.max(1, Math.floor(rawLimit));
        if (Number.isFinite(limit)) {
          this.poolConcurrency.set(pool, limit);
        }
      }
    }
  }

  register(definition: JobDefinition): void {
    if (this.registry.has(definition.kind)) {
      throw new Error(`Job handler already registered for ${definition.kind}`);
    }
    this.registry.set(definition.kind, {
      handler: definition.handler,
      maxAttempts: definition.maxAttempts ?? 1,
      pool: normalizePoolName(definition.pool) ?? this.defaultPool
    });
  }

  async enqueue(kind: string, payload?: JsonObject): Promise<JobId> {
    const jobId = newJobId();
    const event = createEvent(
      "JOB_ENQUEUED",
      { jobId, kind, payload },
      { jobId }
    );
    await this.appendEvent(event);
    this.queue.push(jobId);
    this.schedule();
    return jobId;
  }

  async enqueueDeduped(kind: string, payload?: JsonObject): Promise<JobId> {
    const existing = this.store.findActiveByKindAndPayload(kind, payload);
    if (existing) {
      return existing.jobId;
    }
    return this.enqueue(kind, payload);
  }

  resumePending(): number {
    this.store.resetRunningToQueued();
    const runnable = this.store.getRunnableJobIds();
    for (const jobId of runnable) {
      this.queue.push(jobId);
    }
    this.schedule();
    return runnable.length;
  }

  async runUntilIdle(): Promise<void> {
    while (true) {
      this.schedule();
      if (this.queue.length === 0 && this.inflight.size === 0 && this.retryTimers.size === 0) {
        return;
      }
      if (this.inflight.size === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        continue;
      }
      await Promise.race(this.inflight);
    }
  }

  private schedule(): void {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const jobId = this.dequeueNextRunnable();
      if (!jobId) {
        return;
      }
      const promise = this.runJob(jobId);
      this.inflight.add(promise);
      promise.finally(() => {
        this.inflight.delete(promise);
        this.schedule();
      });
    }
  }

  private dequeueNextRunnable(): JobId | null {
    for (let index = 0; index < this.queue.length; index += 1) {
      const jobId = this.queue[index];
      if (!jobId) {
        continue;
      }

      const job = this.store.get(jobId);
      if (!job || job.status !== "queued") {
        this.queue.splice(index, 1);
        index -= 1;
        continue;
      }

      const pool = this.resolvePoolForKind(job.kind);
      if (this.getPoolActiveCount(pool) >= this.getPoolLimit(pool)) {
        continue;
      }

      this.queue.splice(index, 1);
      return jobId;
    }

    return null;
  }

  private async runJob(jobId: JobId): Promise<void> {
    const job = this.store.get(jobId);
    if (!job || job.status !== "queued") {
      return;
    }

    const pool = this.resolvePoolForKind(job.kind);
    this.activeCount += 1;
    this.incrementPoolActiveCount(pool);

    try {
      const registered = this.registry.get(job.kind);
      if (!registered) {
        await this.appendEvent(
          createEvent(
            "JOB_FAILED",
            { jobId, error: `No handler registered for ${job.kind}` },
            { jobId }
          )
        );
        return;
      }

      const attempt = job.attempts + 1;
      if (attempt > registered.maxAttempts) {
        await this.appendEvent(
          createEvent(
            "JOB_FAILED",
            { jobId, error: `Max attempts exceeded for ${job.kind}` },
            { jobId }
          )
        );
        return;
      }

      const startedAt = Date.now();
      await this.appendEvent(
        createEvent(
          "JOB_STARTED",
          { jobId, kind: job.kind, attempt },
          { jobId }
        )
      );

      try {
        await registered.handler({
          jobId,
          kind: job.kind,
          payload: job.payload,
          attempt,
          startedAt
        });
        await this.appendEvent(createEvent("JOB_COMPLETED", { jobId }, { jobId }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < registered.maxAttempts) {
          const backoffMs = computeRetryBackoffMs(attempt);
          const retryAt = Date.now() + backoffMs;
          await this.appendEvent(
            createEvent(
              "JOB_RETRY_SCHEDULED",
              { jobId, kind: job.kind, attempt, retryAt, error: message },
              { jobId }
            )
          );
          this.scheduleRetry(jobId, backoffMs);
        } else {
          await this.appendEvent(
            createEvent("JOB_FAILED", { jobId, error: message }, { jobId })
          );
        }
      }
    } finally {
      this.activeCount -= 1;
      this.decrementPoolActiveCount(pool);
    }
  }

  private resolvePoolForKind(kind: string): string {
    return this.registry.get(kind)?.pool ?? this.defaultPool;
  }

  private getPoolLimit(pool: string): number {
    return this.poolConcurrency.get(pool) ?? this.concurrency;
  }

  private getPoolActiveCount(pool: string): number {
    return this.activeCountByPool.get(pool) ?? 0;
  }

  private incrementPoolActiveCount(pool: string): void {
    const current = this.activeCountByPool.get(pool) ?? 0;
    this.activeCountByPool.set(pool, current + 1);
  }

  private decrementPoolActiveCount(pool: string): void {
    const current = this.activeCountByPool.get(pool) ?? 0;
    if (current <= 1) {
      this.activeCountByPool.delete(pool);
      return;
    }
    this.activeCountByPool.set(pool, current - 1);
  }

  private scheduleRetry(jobId: JobId, backoffMs: number): void {
    const existingTimer = this.retryTimers.get(jobId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.retryTimers.delete(jobId);
      this.queue.push(jobId);
      this.schedule();
    }, Math.max(0, backoffMs));
    this.retryTimers.set(jobId, timer);
  }

  private async appendEvent(event: DomainEvent): Promise<void> {
    await this.eventWriter.append(event);
    this.store.applyEvent(event);
  }
}

function normalizePoolName(pool: string | undefined): string {
  const normalized = pool?.trim();
  return normalized && normalized.length > 0 ? normalized : "default";
}
