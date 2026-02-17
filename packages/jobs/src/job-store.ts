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

function stablePayloadKey(payload: JsonObject | undefined): string {
  if (!payload) {
    return "";
  }
  return JSON.stringify(sortJsonObject(payload));
}

function sortJsonObject(value: JsonObject): JsonObject {
  const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sorted: JsonObject = {};
  for (const [key, item] of entries) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      sorted[key] = sortJsonObject(item as JsonObject);
      continue;
    }
    if (Array.isArray(item)) {
      sorted[key] = item.map((entry) => {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          return sortJsonObject(entry as JsonObject);
        }
        return entry;
      });
      continue;
    }
    sorted[key] = item;
  }
  return sorted;
}

export class JobStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobStoreError";
  }
}

export class JobStore {
  private readonly jobs = new Map<JobId, JobRecord>();

  findActiveByKindAndPayload(kind: string, payload: JsonObject | undefined): JobRecord | undefined {
    const targetPayloadKey = stablePayloadKey(payload);
    for (const job of this.jobs.values()) {
      if (job.kind !== kind) {
        continue;
      }
      if (job.status !== "queued" && job.status !== "running") {
        continue;
      }
      if (stablePayloadKey(job.payload) === targetPayloadKey) {
        return job;
      }
    }
    return undefined;
  }

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
        job.lastError = undefined;
        job.updatedAt = event.createdAt;
        return;
      }
      case "JOB_RETRY_SCHEDULED": {
        const job = this.require(event.payload.jobId);
        if (job.kind !== event.payload.kind) {
          throw new JobStoreError(`Job kind mismatch for ${job.jobId}`);
        }
        job.status = "queued";
        job.attempts = Math.max(job.attempts, event.payload.attempt);
        job.lastError = event.payload.error;
        job.updatedAt = event.payload.retryAt;
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
