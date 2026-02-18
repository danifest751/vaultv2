export type SourceDto = {
  sourceId: string;
  path: string;
  recursive: boolean;
  includeArchives: boolean;
  excludeGlobs: string[];
  createdAt: number;
};

export type MediaDto = {
  mediaId: string;
  sha256: string;
  size: number;
  sourceEntryId: string;
};

export type MediaMetadataDto = {
  kind?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  takenAt?: number;
  cameraModel?: string;
};

export type MediaDetailsDto = {
  media: MediaDto;
  metadata?: MediaMetadataDto;
};

export type AlbumDto = {
  albumId: string;
  name: string;
  mediaIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type DuplicateLinkDto = {
  duplicateLinkId: string;
  level: "exact" | "strong" | "probable";
  mediaId: string;
  sourceEntryId: string;
  reason?: string;
  createdAt: number;
};

export type QuarantineItemDto = {
  quarantineId: string;
  sourceEntryId: string;
  candidateMediaIds: string[];
  status: "pending" | "accepted" | "rejected";
  acceptedMediaId?: string;
  rejectedReason?: string;
  createdAt: number;
  resolvedAt?: number;
};

export type JobDto = {
  jobId: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  attempt: number;
  queuedAt?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
};

export type ToolsHealthDto = {
  checkedAt: number;
  tools: {
    exiftool: boolean;
    ffprobe: boolean;
    ffmpeg: boolean;
  };
};

export type SnapshotPointerDto = {
  walSeq: number;
  snapshotPath: string;
};

export type QuarantineStatusFilter = "" | "pending" | "accepted" | "rejected";
export type DuplicateLevelFilter = "" | "exact" | "strong" | "probable";

export type MediaSearchSort = "mediaId_asc" | "takenAt_desc";

export type MediaSearchFilters = {
  kind: string;
  mimeType: string;
  sourceId: string;
  duplicateLevel: string;
  cameraModel: string;
  takenDay: string;
  gpsTile: string;
  sha256Prefix: string;
  sort: MediaSearchSort;
};

export type MediaPageResponse = {
  media: MediaDto[];
  total: number;
  limit: number;
  offset: number;
};

export type MediaSearchResponse = {
  media: MediaDto[];
  total: number;
  nextCursor: string | null;
};

export type AppMetrics = {
  sources: number;
  albums: number;
  media: number;
  entries: number;
  quarantinePending: number;
  duplicates: number;
  jobsActive: number;
};
