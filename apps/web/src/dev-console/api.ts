import {
  AlbumDto,
  DuplicateLinkDto,
  JobDto,
  MediaDetailsDto,
  MediaPageResponse,
  MediaSearchFilters,
  MediaSearchResponse,
  QuarantineItemDto,
  SnapshotPointerDto,
  SourceDto,
  ToolsHealthDto
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildHeaders(authToken: string, initHeaders?: HeadersInit): HeadersInit {
  const headers = new Headers(initHeaders);
  if (authToken.trim()) {
    headers.set("authorization", `Bearer ${authToken.trim()}`);
  }
  return headers;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as { error?: string } & T;
  if (!response.ok) {
    throw new ApiError(body?.error ?? `HTTP ${response.status}`, response.status);
  }
  return body;
}

async function requestJson<T>(url: string, authToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: buildHeaders(authToken, init?.headers)
  });
  return parseJsonResponse<T>(response);
}

export async function getSources(authToken: string): Promise<SourceDto[]> {
  const body = await requestJson<{ sources: SourceDto[] }>("/api/sources", authToken);
  return body.sources;
}

export async function createSource(authToken: string, payload: { path: string }): Promise<SourceDto> {
  const body = await requestJson<{ source: SourceDto }>("/api/sources", authToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return body.source;
}

export async function removeSource(authToken: string, sourceId: string): Promise<void> {
  await requestJson<{ sourceId: string }>(`/api/sources/${encodeURIComponent(sourceId)}`, authToken, {
    method: "DELETE"
  });
}

export async function scanSource(authToken: string, sourceId: string): Promise<void> {
  await requestJson<{ jobId: string }>("/api/jobs/scan", authToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceId })
  });
}

export async function pickSourcePath(authToken: string): Promise<string | null> {
  const body = await requestJson<{ path: string | null }>("/api/fs/dialog", authToken);
  return body.path;
}

export async function getAlbums(authToken: string): Promise<AlbumDto[]> {
  const body = await requestJson<{ albums: AlbumDto[] }>("/api/albums", authToken);
  return body.albums;
}

export async function createAlbum(
  authToken: string,
  payload: { name: string; mediaIds?: string[] }
): Promise<AlbumDto> {
  const body = await requestJson<{ album: AlbumDto }>("/api/albums", authToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return body.album;
}

export async function updateAlbum(
  authToken: string,
  albumId: string,
  payload: { name: string; mediaIds: string[] }
): Promise<AlbumDto> {
  const body = await requestJson<{ album: AlbumDto }>(`/api/albums/${encodeURIComponent(albumId)}`, authToken, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return body.album;
}

export async function removeAlbum(authToken: string, albumId: string): Promise<void> {
  await requestJson<{ albumId: string }>(`/api/albums/${encodeURIComponent(albumId)}`, authToken, {
    method: "DELETE"
  });
}

export async function getMediaPage(authToken: string, limit: number, offset: number): Promise<MediaPageResponse> {
  return requestJson<MediaPageResponse>(`/api/media?limit=${limit}&offset=${offset}`, authToken);
}

export async function getMediaDetails(authToken: string, mediaId: string): Promise<MediaDetailsDto> {
  return requestJson<MediaDetailsDto>(`/api/media/${encodeURIComponent(mediaId)}`, authToken);
}

export async function searchMedia(
  authToken: string,
  filters: MediaSearchFilters,
  cursor?: string
): Promise<MediaSearchResponse> {
  const query = new URLSearchParams();
  query.set("limit", "50");
  query.set("sort", filters.sort);
  if (cursor) {
    query.set("cursor", cursor);
  }
  if (filters.kind) query.set("kind", filters.kind);
  if (filters.mimeType) query.set("mimeType", filters.mimeType);
  if (filters.sourceId) query.set("sourceId", filters.sourceId);
  if (filters.duplicateLevel) query.set("duplicateLevel", filters.duplicateLevel);
  if (filters.cameraModel) query.set("cameraModel", filters.cameraModel);
  if (filters.takenDay) query.set("takenDay", filters.takenDay);
  if (filters.gpsTile) query.set("gpsTile", filters.gpsTile);
  if (filters.sha256Prefix) query.set("sha256Prefix", filters.sha256Prefix);
  return requestJson<MediaSearchResponse>(`/api/media/search?${query.toString()}`, authToken);
}

export async function getQuarantine(authToken: string, status?: "pending" | "accepted" | "rejected"): Promise<QuarantineItemDto[]> {
  const query = status ? `?status=${status}` : "";
  const body = await requestJson<{ items: QuarantineItemDto[] }>(`/api/quarantine${query}`, authToken);
  return body.items;
}

export async function getQuarantineItem(authToken: string, quarantineId: string): Promise<QuarantineItemDto> {
  const body = await requestJson<{ item: QuarantineItemDto }>(`/api/quarantine/${encodeURIComponent(quarantineId)}`, authToken);
  return body.item;
}

export async function acceptQuarantine(authToken: string, quarantineId: string, acceptedMediaId: string): Promise<void> {
  await requestJson<{ item: QuarantineItemDto }>(`/api/quarantine/${encodeURIComponent(quarantineId)}/accept`, authToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ acceptedMediaId })
  });
}

export async function rejectQuarantine(authToken: string, quarantineId: string, reason?: string): Promise<void> {
  await requestJson<{ item: QuarantineItemDto }>(`/api/quarantine/${encodeURIComponent(quarantineId)}/reject`, authToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: reason || undefined })
  });
}

export async function getDuplicateLinks(authToken: string, level?: "exact" | "strong" | "probable"): Promise<DuplicateLinkDto[]> {
  const query = level ? `?level=${level}` : "";
  const body = await requestJson<{ links: DuplicateLinkDto[] }>(`/api/duplicate-links${query}`, authToken);
  return body.links;
}

export async function getJobs(authToken: string): Promise<JobDto[]> {
  const body = await requestJson<{ jobs: JobDto[] }>("/api/jobs", authToken);
  return body.jobs;
}

export async function createSnapshot(authToken: string): Promise<SnapshotPointerDto> {
  return requestJson<SnapshotPointerDto>("/api/snapshots", authToken, { method: "POST" });
}

export async function getSnapshotPointer(authToken: string): Promise<SnapshotPointerDto | null> {
  try {
    return await requestJson<SnapshotPointerDto>("/api/snapshots/pointer", authToken);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getToolsHealth(authToken: string): Promise<ToolsHealthDto> {
  return requestJson<ToolsHealthDto>("/api/health/tools", authToken);
}
