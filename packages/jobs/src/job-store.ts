import { DomainEvent, JobId, JsonObject } from "@family-media-vault/core";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobRecord {
  jobId: JobId;
  kind: string;
  payload?: JsonObject;
  status: JobStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export class JobStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobStoreError";
  }
}

export class JobStore {
  private readonly jobs = new Map<JobId, JobRecord>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "JOB_ENQUEUED":
        this.applyEnqueued(event.payload.jobId, event.payload.kind, event.payload.payload, event.createdAt);
        return;
      case "JOB_STARTED": {
        const job = this.require(event.payload.jobId);
        if (job.kind !== event.payload.kind) {
          throw new JobStoreError(`Job kind mismatch for ${job.jobId}`);
        }
        job.status = "running";
        job.attempts = Math.max(job.attempts, event.payload.attempt);
        job.updatedAt = event.createdAt;
        return;
      }
      case "JOB_COMPLETED": {
        const job = this.require(event.payload.jobId);
        job.status = "completed";
        job.updatedAt = event.createdAt;
        return;
      }
      case "JOB_FAILED": {
        const job = this.require(event.payload.jobId);
        job.status = "failed";
        job.lastError = event.payload.error;
        job.updatedAt = event.createdAt;
        return;
      }
      default:
        return;
    }
  }

  get(jobId: JobId): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  list(): JobRecord[] {
    return Array.from(this.jobs.values());
  }

  listByStatus(status: JobStatus): JobRecord[] {
    return this.list().filter((job) => job.status === status);
  }

  getRunnableJobIds(): JobId[] {
    return this.list()
      .filter((job) => job.status === "queued" || job.status === "running")
      .map((job) => job.jobId);
  }

  resetRunningToQueued(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "running") {
        job.status = "queued";
        count += 1;
      }
    }
    return count;
  }

  private applyEnqueued(jobId: JobId, kind: string, payload: JsonObject | undefined, createdAt: number): void {
    if (this.jobs.has(jobId)) {
      return;
    }
    this.jobs.set(jobId, {
      jobId,
      kind,
      payload,
      status: "queued",
      attempts: 0,
      createdAt,
      updatedAt: createdAt
    });
  }

  private require(jobId: JobId): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new JobStoreError(`Unknown job ${jobId}`);
    }
    return job;
  }
}

export async function rebuildJobStore(
  events: Iterable<DomainEvent> | AsyncIterable<DomainEvent>
): Promise<JobStore> {
  const store = new JobStore();
  if (Symbol.asyncIterator in events) {
    for await (const event of events as AsyncIterable<DomainEvent>) {
      store.applyEvent(event);
    }
  } else {
    for (const event of events as Iterable<DomainEvent>) {
      store.applyEvent(event);
    }
  }
  return store;
}
