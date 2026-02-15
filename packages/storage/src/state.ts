import {
  DomainEvent,
  Media,
  Source,
  SourceEntry,
  SourceEntryId,
  SourceId,
  MediaId
} from "@family-media-vault/core";

export class SourceStore {
  private readonly sources = new Map<SourceId, Source>();
  private readonly entries = new Map<SourceEntryId, SourceEntry>();
  private readonly entryKeyIndex = new Map<string, SourceEntryId>();

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
        this.entries.set(event.payload.entry.sourceEntryId, event.payload.entry);
        this.entryKeyIndex.set(this.entryKey(event.payload.entry), event.payload.entry.sourceEntryId);
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

  getEntry(entryId: SourceEntryId): SourceEntry | undefined {
    return this.entries.get(entryId);
  }

  getEntryByIdentity(sourceId: SourceId, kind: SourceEntry["kind"], path?: string, archivePath?: string, innerPath?: string):
    | SourceEntry
    | undefined {
    const key = this.entryKey({
      sourceEntryId: "" as SourceEntryId,
      sourceId,
      kind,
      path,
      archivePath,
      innerPath,
      size: 0,
      mtimeMs: 0,
      fingerprint: "",
      lastSeenAt: 0,
      state: "active"
    });
    const entryId = this.entryKeyIndex.get(key);
    return entryId ? this.entries.get(entryId) : undefined;
  }

  listEntriesForSource(sourceId: SourceId): SourceEntry[] {
    return Array.from(this.entries.values()).filter((entry) => entry.sourceId === sourceId);
  }

  private entryKey(entry: Pick<SourceEntry, "sourceId" | "kind" | "path" | "archivePath" | "innerPath">): string {
    if (entry.kind === "archive_entry") {
      return `${entry.sourceId}:archive:${entry.archivePath ?? ""}::${entry.innerPath ?? ""}`;
    }
    return `${entry.sourceId}:file:${entry.path ?? ""}`;
  }
}

export class MediaStore {
  private readonly mediaBySha = new Map<string, Media>();
  private readonly mediaById = new Map<MediaId, Media>();

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "MEDIA_IMPORTED": {
        const media = event.payload.media;
        this.mediaBySha.set(media.sha256, media);
        this.mediaById.set(media.mediaId, media);
        return;
      }
      default:
        return;
    }
  }

  getBySha256(sha256: string): Media | undefined {
    return this.mediaBySha.get(sha256);
  }

  get(mediaId: MediaId): Media | undefined {
    return this.mediaById.get(mediaId);
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
}

export class DomainState {
  readonly sources = new SourceStore();
  readonly media = new MediaStore();
  readonly ingest = new IngestStore();

  applyEvent(event: DomainEvent): void {
    this.sources.applyEvent(event);
    this.media.applyEvent(event);
    this.ingest.applyEvent(event);
  }
}
