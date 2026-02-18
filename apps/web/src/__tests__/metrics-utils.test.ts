import { describe, expect, it } from "vitest";
import { buildAppMetrics } from "../dev-console/overview/metrics-utils";
import { JobDto, QuarantineItemDto } from "../dev-console/types";

describe("buildAppMetrics", () => {
  it("counts pending quarantine and active jobs", () => {
    const quarantineItems: QuarantineItemDto[] = [
      {
        quarantineId: "q1",
        sourceEntryId: "se1",
        candidateMediaIds: ["m1"],
        status: "pending",
        createdAt: 1
      },
      {
        quarantineId: "q2",
        sourceEntryId: "se2",
        candidateMediaIds: ["m2"],
        status: "accepted",
        createdAt: 2
      }
    ];

    const jobs: JobDto[] = [
      { jobId: "j1", kind: "scan", status: "queued", attempt: 1 },
      { jobId: "j2", kind: "scan", status: "running", attempt: 1 },
      { jobId: "j3", kind: "scan", status: "completed", attempt: 1 }
    ];

    const metrics = buildAppMetrics({
      sourcesCount: 3,
      albumsCount: 2,
      mediaTotal: 120,
      duplicateLinksCount: 5,
      quarantineItems,
      jobs
    });

    expect(metrics).toEqual({
      sources: 3,
      albums: 2,
      media: 120,
      entries: 0,
      quarantinePending: 1,
      duplicates: 5,
      jobsActive: 2
    });
  });
});
