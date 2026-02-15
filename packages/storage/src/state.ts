import {
  DomainEvent,
  DuplicateLink,
  Media,
  MediaId,
  MediaMetadata,
  QuarantineItem,
  QuarantineItemId,
  Source,
  SourceEntry,
  SourceEntryId,
  SourceId
} from "@family-media-vault/core";

export class SourceStore {
  private readonly sources = new Map<SourceId, Source>();
  private readonly entries = new Map<SourceEntryId, SourceEntry>();
  private readonly entryKeyIndex = new Map<string, SourceEntryId>();
  private readonly headHashIndex = new Map<string, Set<SourceEntryId>>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "SOURCE_CREATED":
      case "SOURCE_UPDATED":
        this.sources.set(event.payload.source.sourceId, event.payload.source);
        return;
      case "SOURCE_REMOVED":
        this.sources.delete(event.payload.sourceId);
        for (const [entryId, entry] of this.entries) {
          if (entry.sourceId === event.payload.sourceId) {
            this.removeFromHeadIndex(entry);
            this.entries.delete(entryId);
          }
        }
        for (const [key, entryId] of this.entryKeyIndex) {
          const entry = this.entries.get(entryId);
          if (!entry) {
            this.entryKeyIndex.delete(key);
          }
        }
        return;
      case "SOURCE_ENTRY_UPSERTED":
        this.replaceEntry(event.payload.entry);
        return;
      case "SOURCE_ENTRY_MARKED_MISSING": {
        const entry = this.entries.get(event.payload.sourceEntryId);
        if (entry) {
          entry.state = "missing";
          entry.lastSeenAt = event.payload.lastSeenAt;
          this.entries.set(entry.sourceEntryId, entry);
        }
        return;
      }
      default:
        return;
    }
  }

  getSource(sourceId: SourceId): Source | undefined {
    return this.sources.get(sourceId);
  }

  listSources(): Source[] {
    return Array.from(this.sources.values());
  }

  listEntries(): SourceEntry[] {
    return Array.from(this.entries.values());
  }

  upsertSource(source: Source): void {
    this.sources.set(source.sourceId, source);
  }

  upsertEntry(entry: SourceEntry): void {
    this.replaceEntry(entry);
  }

  getEntry(entryId: SourceEntryId): SourceEntry | undefined {
    return this.entries.get(entryId);
  }

  getEntryByIdentity(sourceId: SourceId, kind: SourceEntry["kind"], path?: string, archivePath?: string, innerPath?: string):
    | SourceEntry
    | undefined {
    const key = this.entryKey({
      sourceId,
      kind,
      path,
      archivePath,
      innerPath
    });
    const entryId = this.entryKeyIndex.get(key);
    return entryId ? this.entries.get(entryId) : undefined;
  }

  listEntriesForSource(sourceId: SourceId): SourceEntry[] {
    return Array.from(this.entries.values()).filter((entry) => entry.sourceId === sourceId);
  }

  listEntriesByHeadHash(size: number, headHash: string): SourceEntry[] {
    const key = headHashKey(size, headHash);
    const ids = this.headHashIndex.get(key);
    if (!ids) {
      return [];
    }
    const results: SourceEntry[] = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        results.push(entry);
      }
    }
    return results;
  }

  getHeadHashKey(entry: SourceEntry): { size: number; headHash: string } | null {
    return parseFingerprint(entry.fingerprint);
  }

  private entryKey(entry: Pick<SourceEntry, "sourceId" | "kind" | "path" | "archivePath" | "innerPath">): string {
    if (entry.kind === "archive_entry") {
      return `${entry.sourceId}:archive:${entry.archivePath ?? ""}::${entry.innerPath ?? ""}`;
    }
    return `${entry.sourceId}:file:${entry.path ?? ""}`;
  }

  private replaceEntry(entry: SourceEntry): void {
    const existing = this.entries.get(entry.sourceEntryId);
    if (existing) {
      this.removeFromHeadIndex(existing);
    }
    this.entries.set(entry.sourceEntryId, entry);
    this.entryKeyIndex.set(this.entryKey(entry), entry.sourceEntryId);
    this.addToHeadIndex(entry);
  }

  private addToHeadIndex(entry: SourceEntry): void {
    const parsed = parseFingerprint(entry.fingerprint);
    if (!parsed) {
      return;
    }
    const key = headHashKey(parsed.size, parsed.headHash);
    const bucket = this.headHashIndex.get(key) ?? new Set<SourceEntryId>();
    bucket.add(entry.sourceEntryId);
    this.headHashIndex.set(key, bucket);
  }

  private removeFromHeadIndex(entry: SourceEntry): void {
    const parsed = parseFingerprint(entry.fingerprint);
    if (!parsed) {
      return;
    }
    const key = headHashKey(parsed.size, parsed.headHash);
    const bucket = this.headHashIndex.get(key);
    if (!bucket) {
      return;
    }
    bucket.delete(entry.sourceEntryId);
    if (bucket.size === 0) {
      this.headHashIndex.delete(key);
    }
  }
}

export class MediaStore {
  private readonly mediaBySha = new Map<string, Media>();
  private readonly mediaById = new Map<MediaId, Media>();
  private readonly mediaByEntryId = new Map<SourceEntryId, Media>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "MEDIA_IMPORTED": {
        const media = event.payload.media;
        this.mediaBySha.set(media.sha256, media);
        this.mediaById.set(media.mediaId, media);
        this.mediaByEntryId.set(media.sourceEntryId, media);
        return;
      }
      default:
        return;
    }
  }

  upsertMedia(media: Media): void {
    this.mediaBySha.set(media.sha256, media);
    this.mediaById.set(media.mediaId, media);
    this.mediaByEntryId.set(media.sourceEntryId, media);
  }

  getBySha256(sha256: string): Media | undefined {
    return this.mediaBySha.get(sha256);
  }

  get(mediaId: MediaId): Media | undefined {
    return this.mediaById.get(mediaId);
  }

  getBySourceEntryId(entryId: SourceEntryId): Media | undefined {
    return this.mediaByEntryId.get(entryId);
  }

  list(): Media[] {
    return Array.from(this.mediaById.values());
  }
}

export type IngestStatus =
  | { status: "none" }
  | { status: "imported"; mediaId: MediaId }
  | { status: "duplicate"; existingMediaId: MediaId };

export class IngestStore {
  private readonly statusByEntry = new Map<SourceEntryId, IngestStatus>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "MEDIA_IMPORTED":
        this.statusByEntry.set(event.payload.media.sourceEntryId, {
          status: "imported",
          mediaId: event.payload.media.mediaId
        });
        return;
      case "MEDIA_SKIPPED_DUPLICATE_EXACT":
        this.statusByEntry.set(event.payload.sourceEntryId, {
          status: "duplicate",
          existingMediaId: event.payload.existingMediaId
        });
        return;
      default:
        return;
    }
  }

  getStatus(entryId: SourceEntryId): IngestStatus {
    return this.statusByEntry.get(entryId) ?? { status: "none" };
  }

  listStatuses(): Array<{ sourceEntryId: SourceEntryId; status: IngestStatus }> {
    return Array.from(this.statusByEntry.entries()).map(([sourceEntryId, status]) => ({
      sourceEntryId,
      status
    }));
  }

  setStatus(sourceEntryId: SourceEntryId, status: IngestStatus): void {
    this.statusByEntry.set(sourceEntryId, status);
  }
}

export class MediaMetadataStore {
  private readonly metadataByMediaId = new Map<MediaId, MediaMetadata>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "MEDIA_METADATA_EXTRACTED":
        this.metadataByMediaId.set(event.payload.mediaId, event.payload.metadata);
        return;
      default:
        return;
    }
  }

  get(mediaId: MediaId): MediaMetadata | undefined {
    return this.metadataByMediaId.get(mediaId);
  }

  list(): Array<{ mediaId: MediaId; metadata: MediaMetadata }> {
    return Array.from(this.metadataByMediaId.entries()).map(([mediaId, metadata]) => ({
      mediaId,
      metadata
    }));
  }

  set(mediaId: MediaId, metadata: MediaMetadata): void {
    this.metadataByMediaId.set(mediaId, metadata);
  }
}

export class DuplicateLinkStore {
  private readonly linksByKey = new Map<string, DuplicateLink>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "DUPLICATE_LINK_CREATED": {
        const link = event.payload.link;
        const key = duplicateLinkKey(link.mediaId, link.sourceEntryId, link.level);
        if (this.linksByKey.has(key)) {
          return;
        }
        this.linksByKey.set(key, link);
        return;
      }
      default:
        return;
    }
  }

  has(mediaId: MediaId, sourceEntryId: SourceEntryId, level: DuplicateLink["level"]): boolean {
    return this.linksByKey.has(duplicateLinkKey(mediaId, sourceEntryId, level));
  }

  list(): DuplicateLink[] {
    return Array.from(this.linksByKey.values());
  }

  set(link: DuplicateLink): void {
    this.linksByKey.set(duplicateLinkKey(link.mediaId, link.sourceEntryId, link.level), link);
  }
}

export class QuarantineStore {
  private readonly items = new Map<QuarantineItemId, QuarantineItem>();
  private readonly byEntryId = new Map<SourceEntryId, QuarantineItemId>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "QUARANTINE_CREATED": {
        if (this.byEntryId.has(event.payload.item.sourceEntryId)) {
          return;
        }
        this.items.set(event.payload.item.quarantineId, event.payload.item);
        this.byEntryId.set(event.payload.item.sourceEntryId, event.payload.item.quarantineId);
        return;
      }
      case "QUARANTINE_ACCEPTED": {
        const item = this.items.get(event.payload.quarantineId);
        if (!item || item.status !== "pending") {
          return;
        }
        item.status = "accepted";
        item.resolvedAt = event.payload.resolvedAt;
        item.acceptedMediaId = event.payload.acceptedMediaId;
        item.rejectedReason = undefined;
        this.items.set(item.quarantineId, item);
        return;
      }
      case "QUARANTINE_REJECTED": {
        const item = this.items.get(event.payload.quarantineId);
        if (!item || item.status !== "pending") {
          return;
        }
        item.status = "rejected";
        item.resolvedAt = event.payload.resolvedAt;
        item.rejectedReason = event.payload.reason;
        item.acceptedMediaId = undefined;
        this.items.set(item.quarantineId, item);
        return;
      }
      default:
        return;
    }
  }

  get(quarantineId: QuarantineItemId): QuarantineItem | undefined {
    return this.items.get(quarantineId);
  }

  getBySourceEntryId(sourceEntryId: SourceEntryId): QuarantineItem | undefined {
    const id = this.byEntryId.get(sourceEntryId);
    return id ? this.items.get(id) : undefined;
  }

  list(): QuarantineItem[] {
    return Array.from(this.items.values());
  }

  set(item: QuarantineItem): void {
    this.items.set(item.quarantineId, item);
    this.byEntryId.set(item.sourceEntryId, item.quarantineId);
  }
}

export class DomainState {
  readonly sources = new SourceStore();
  readonly media = new MediaStore();
  readonly ingest = new IngestStore();
  readonly metadata = new MediaMetadataStore();
  readonly duplicateLinks = new DuplicateLinkStore();
  readonly quarantine = new QuarantineStore();

  applyEvent(event: DomainEvent): void {
    this.sources.applyEvent(event);
    this.media.applyEvent(event);
    this.ingest.applyEvent(event);
    this.metadata.applyEvent(event);
    this.duplicateLinks.applyEvent(event);
    this.quarantine.applyEvent(event);
  }
}

function parseFingerprint(fingerprint: string): { size: number; headHash: string } | null {
  const parts = fingerprint.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const size = Number(parts[0]);
  if (!Number.isFinite(size)) {
    return null;
  }
  const headHash = parts[2];
  if (!headHash) {
    return null;
  }
  return { size, headHash };
}

function headHashKey(size: number, headHash: string): string {
  return `${size}:${headHash}`;
}

function duplicateLinkKey(
  mediaId: MediaId,
  sourceEntryId: SourceEntryId,
  level: DuplicateLink["level"]
): string {
  return `${mediaId}:${sourceEntryId}:${level}`;
}
