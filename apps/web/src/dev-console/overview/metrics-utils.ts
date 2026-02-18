import { AppMetrics, JobDto, QuarantineItemDto } from "../types";

export interface BuildAppMetricsInput {
  sourcesCount: number;
  albumsCount: number;
  mediaTotal: number;
  duplicateLinksCount: number;
  quarantineItems: QuarantineItemDto[];
  jobs: JobDto[];
}

export function buildAppMetrics(input: BuildAppMetricsInput): AppMetrics {
  const quarantinePending = input.quarantineItems.filter((item) => item.status === "pending").length;
  const jobsActive = input.jobs.filter((job) => job.status === "queued" || job.status === "running").length;

  return {
    sources: input.sourcesCount,
    albums: input.albumsCount,
    media: input.mediaTotal,
    entries: 0,
    quarantinePending,
    duplicates: input.duplicateLinksCount,
    jobsActive
  };
}
