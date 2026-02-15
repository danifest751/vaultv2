import { randomUUID } from "node:crypto";
import {
  DuplicateLinkId,
  EventId,
  JobId,
  MediaId,
  QuarantineItemId,
  SourceEntryId,
  SourceId,
  newEventId
} from "./ids";
import { assertNonEmptyString } from "./invariants";

export type TimestampMs = number;

export type SourceEntryKind = "file" | "archive_entry";
export type SourceEntryState = "active" | "missing" | "deleted";

export interface Source {
  sourceId: SourceId;
  path: string;
  recursive: boolean;
  includeArchives: boolean;
  excludeGlobs: string[];
  createdAt: TimestampMs;
}

export interface SourceEntry {
  sourceEntryId: SourceEntryId;
  sourceId: SourceId;
  kind: SourceEntryKind;
  path?: string;
  archivePath?: string;
  innerPath?: string;
  size: number;
  mtimeMs: number;
  fingerprint: string;
  lastSeenAt: TimestampMs;
  state: SourceEntryState;
}

export interface Media {
  mediaId: MediaId;
  sha256: string;
  size: number;
  sourceEntryId: SourceEntryId;
}

export type DuplicateLevel = "exact" | "strong" | "probable";

export interface DuplicateLink {
  duplicateLinkId: DuplicateLinkId;
  mediaId: MediaId;
  sourceEntryId: SourceEntryId;
  level: DuplicateLevel;
  createdAt: TimestampMs;
  reason?: string;
}

export type QuarantineStatus = "pending" | "accepted" | "rejected";

export interface QuarantineItem {
  quarantineId: QuarantineItemId;
  sourceEntryId: SourceEntryId;
  candidateMediaIds: MediaId[];
  status: QuarantineStatus;
  createdAt: TimestampMs;
}

export type EventType =
  | "SOURCE_CREATED"
  | "SOURCE_UPDATED"
  | "SOURCE_REMOVED"
  | "SOURCE_ENTRY_UPSERTED"
  | "SOURCE_ENTRY_MARKED_MISSING"
  | "MEDIA_SHA256_COMPUTED"
  | "MEDIA_IMPORTED"
  | "MEDIA_SKIPPED_DUPLICATE_EXACT"
  | "DUPLICATE_LINK_CREATED"
  | "QUARANTINE_CREATED"
  | "JOB_ENQUEUED"
  | "JOB_COMPLETED"
  | "JOB_FAILED";

export type EventPayloads = {
  SOURCE_CREATED: { source: Source };
  SOURCE_UPDATED: { source: Source };
  SOURCE_REMOVED: { sourceId: SourceId };
  SOURCE_ENTRY_UPSERTED: { entry: SourceEntry };
  SOURCE_ENTRY_MARKED_MISSING: {
    sourceEntryId: SourceEntryId;
    sourceId: SourceId;
    lastSeenAt: TimestampMs;
  };
  MEDIA_SHA256_COMPUTED: { sourceEntryId: SourceEntryId; sha256: string; size: number };
  MEDIA_IMPORTED: { media: Media };
  MEDIA_SKIPPED_DUPLICATE_EXACT: { sourceEntryId: SourceEntryId; existingMediaId: MediaId };
  DUPLICATE_LINK_CREATED: { link: DuplicateLink };
  QUARANTINE_CREATED: { item: QuarantineItem };
  JOB_ENQUEUED: { jobId: JobId; kind: string };
  JOB_COMPLETED: { jobId: JobId };
  JOB_FAILED: { jobId: JobId; error: string };
};

export interface EventEnvelope<T extends EventType> {
  eventId: EventId;
  type: T;
  createdAt: TimestampMs;
  jobId?: JobId;
  payload: EventPayloads[T];
}

export type DomainEvent = {
  [K in EventType]: EventEnvelope<K>;
}[EventType];

export interface EventMeta {
  eventId?: EventId;
  createdAt?: TimestampMs;
  jobId?: JobId;
}

export function createEvent<T extends EventType>(
  type: T,
  payload: EventPayloads[T],
  meta: EventMeta = {}
): EventEnvelope<T> {
  if (payload === undefined || payload === null) {
    throw new Error("Event payload is required");
  }

  const eventId = meta.eventId ?? newEventId();
  const createdAt = meta.createdAt ?? Date.now();

  assertNonEmptyString(type, "Event type");

  return {
    eventId,
    type,
    createdAt,
    jobId: meta.jobId,
    payload
  };
}

export function newEventIdLike(): EventId {
  return newEventId();
}

export function newJobIdLike(prefix?: string): JobId {
  const value = `${prefix ?? "job"}_${randomUUID()}`;
  return value as JobId;
}
