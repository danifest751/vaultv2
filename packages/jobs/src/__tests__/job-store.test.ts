import { describe, expect, it } from "vitest";
import { createEvent, newJobId } from "@family-media-vault/core";
import { JobStore } from "../job-store";

describe("JobStore", () => {
  it("applies job lifecycle events", () => {
    const store = new JobStore();
    const jobId = newJobId();

    store.applyEvent(
      createEvent("JOB_ENQUEUED", {
        jobId,
        kind: "scan",
        payload: { sourceId: "src_1" }
      })
    );

    store.applyEvent(
      createEvent("JOB_STARTED", {
        jobId,
        kind: "scan",
        attempt: 1
      })
    );

    store.applyEvent(
      createEvent("JOB_COMPLETED", {
        jobId
      })
    );

    const job = store.get(jobId);
    expect(job?.status).toBe("completed");
    expect(job?.attempts).toBe(1);
  });

  it("resets running jobs to queued", () => {
    const store = new JobStore();
    const jobId = newJobId();

    store.applyEvent(
      createEvent("JOB_ENQUEUED", {
        jobId,
        kind: "scan"
      })
    );

    store.applyEvent(
      createEvent("JOB_STARTED", {
        jobId,
        kind: "scan",
        attempt: 1
      })
    );

    const reset = store.resetRunningToQueued();
    const job = store.get(jobId);

    expect(reset).toBe(1);
    expect(job?.status).toBe("queued");
  });

  it("moves job back to queued on retry scheduling", () => {
    const store = new JobStore();
    const jobId = newJobId();

    store.applyEvent(
      createEvent("JOB_ENQUEUED", {
        jobId,
        kind: "metadata:extract"
      })
    );
    store.applyEvent(
      createEvent("JOB_STARTED", {
        jobId,
        kind: "metadata:extract",
        attempt: 1
      })
    );
    store.applyEvent(
      createEvent("JOB_RETRY_SCHEDULED", {
        jobId,
        kind: "metadata:extract",
        attempt: 1,
        retryAt: 1234,
        error: "tool_missing"
      })
    );

    const job = store.get(jobId);
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(1);
    expect(job?.lastError).toBe("tool_missing");
    expect(job?.updatedAt).toBe(1234);
  });
});
