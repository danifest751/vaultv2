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

export interface MediaSearchFilters {
  kind?: "photo" | "video" | "unknown";
  mimeType?: string;
  sourceId?: SourceId;
  duplicateLevel?: DuplicateLink["level"];
  cameraModel?: string;
  takenDay?: string;
  gpsTile?: string;
  sha256Prefix?: string;
}

export type MediaSearchSort = "mediaId_asc" | "takenAt_desc";

const EMPTY_MEDIA_ID_SET: ReadonlySet<MediaId> = new Set<MediaId>();

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
  private readonly perceptualHashByMediaId = new Map<MediaId, string>();
  private readonly perceptualHashPrefixIndex = new Map<string, Set<MediaId>>();
  private readonly perceptualHashPrefixLength = 4;

  applyEvent(event: DomainEvent): void {
    switch (event.type) {
      case "MEDIA_METADATA_EXTRACTED":
        this.set(event.payload.mediaId, event.payload.metadata);
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

  listMediaIdsByPerceptualHashPrefix(prefix: string): MediaId[] {
    const normalized = normalizePerceptualHash(prefix);
    if (!normalized) {
      return [];
    }
    const key = normalized.slice(0, this.perceptualHashPrefixLength);
    const bucket = this.perceptualHashPrefixIndex.get(key);
    return bucket ? Array.from(bucket) : [];
  }

  getPerceptualHash(mediaId: MediaId): string | undefined {
    return this.perceptualHashByMediaId.get(mediaId);
  }

  set(mediaId: MediaId, metadata: MediaMetadata): void {
    this.metadataByMediaId.set(mediaId, metadata);
    const previous = this.perceptualHashByMediaId.get(mediaId);
    if (previous) {
      const previousPrefix = previous.slice(0, this.perceptualHashPrefixLength);
      const previousBucket = this.perceptualHashPrefixIndex.get(previousPrefix);
      if (previousBucket) {
        previousBucket.delete(mediaId);
        if (previousBucket.size === 0) {
          this.perceptualHashPrefixIndex.delete(previousPrefix);
        }
      }
      this.perceptualHashByMediaId.delete(mediaId);
    }

    const perceptualHash = normalizePerceptualHash(metadata.raw?.perceptualHash);
    if (!perceptualHash) {
      return;
    }

    this.perceptualHashByMediaId.set(mediaId, perceptualHash);
    const prefix = perceptualHash.slice(0, this.perceptualHashPrefixLength);
    const bucket = this.perceptualHashPrefixIndex.get(prefix) ?? new Set<MediaId>();
    bucket.add(mediaId);
    this.perceptualHashPrefixIndex.set(prefix, bucket);
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

  hasForSourceEntry(sourceEntryId: SourceEntryId, level?: DuplicateLink["level"]): boolean {
    for (const link of this.linksByKey.values()) {
      if (link.sourceEntryId !== sourceEntryId) {
        continue;
      }
      if (!level || link.level === level) {
        return true;
      }
    }
    return false;
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

export class MediaSearchIndexStore {
  private readonly kindIndex = new Map<string, Set<MediaId>>();
  private readonly mimeTypeIndex = new Map<string, Set<MediaId>>();
  private readonly sourceIdIndex = new Map<SourceId, Set<MediaId>>();
  private readonly duplicateLevelIndex = new Map<DuplicateLink["level"], Set<MediaId>>();
  private readonly cameraModelIndex = new Map<string, Set<MediaId>>();
  private readonly takenDayIndex = new Map<string, Set<MediaId>>();
  private readonly gpsTileIndex = new Map<string, Set<MediaId>>();
  private readonly sha256ExactIndex = new Map<string, Set<MediaId>>();
  private readonly sha256Prefix2Index = new Map<string, Set<MediaId>>();
  private readonly sha256Prefix4Index = new Map<string, Set<MediaId>>();
  private readonly sha256Prefix8Index = new Map<string, Set<MediaId>>();
  private readonly takenAtByMediaId = new Map<MediaId, number>();
  private readonly sha256ByMediaId = new Map<MediaId, string>();
  private readonly kindByMediaId = new Map<MediaId, string>();
  private readonly mimeTypeByMediaId = new Map<MediaId, string>();
  private readonly sourceIdByMediaId = new Map<MediaId, SourceId>();
  private readonly cameraModelByMediaId = new Map<MediaId, string>();
  private readonly takenDayByMediaId = new Map<MediaId, string>();
  private readonly gpsTileByMediaId = new Map<MediaId, string>();

  applyEvent(event: DomainEvent, state: DomainState): void {
    switch (event.type) {
      case "MEDIA_IMPORTED": {
        const media = event.payload.media;
        const entry = state.sources.getEntry(media.sourceEntryId);
        if (entry) {
          this.setSourceId(media.mediaId, entry.sourceId);
        }
        this.setSha256(media.mediaId, media.sha256);
        return;
      }
      case "MEDIA_METADATA_EXTRACTED": {
        this.setKind(event.payload.mediaId, event.payload.metadata.kind);
        this.setMimeType(event.payload.mediaId, event.payload.metadata.mimeType);
        this.setCameraModel(event.payload.mediaId, event.payload.metadata.cameraModel);
        this.setTakenAt(event.payload.mediaId, event.payload.metadata.takenAt);
        this.setTakenDay(event.payload.mediaId, event.payload.metadata.takenAt);
        this.setGpsTile(event.payload.mediaId, extractGpsTileFromMetadata(event.payload.metadata));
        return;
      }
      case "DUPLICATE_LINK_CREATED": {
        this.addDuplicate(event.payload.link.level, event.payload.link.mediaId);
        const linkedMedia = state.media.getBySourceEntryId(event.payload.link.sourceEntryId);
        if (linkedMedia) {
          this.addDuplicate(event.payload.link.level, linkedMedia.mediaId);
        }
        return;
      }
      default:
        return;
    }
  }

  rebuild(state: DomainState): void {
    this.kindIndex.clear();
    this.mimeTypeIndex.clear();
    this.sourceIdIndex.clear();
    this.duplicateLevelIndex.clear();
    this.cameraModelIndex.clear();
    this.takenDayIndex.clear();
    this.gpsTileIndex.clear();
    this.sha256ExactIndex.clear();
    this.sha256Prefix2Index.clear();
    this.sha256Prefix4Index.clear();
    this.sha256Prefix8Index.clear();
    this.takenAtByMediaId.clear();
    this.sha256ByMediaId.clear();
    this.kindByMediaId.clear();
    this.mimeTypeByMediaId.clear();
    this.sourceIdByMediaId.clear();
    this.cameraModelByMediaId.clear();
    this.takenDayByMediaId.clear();
    this.gpsTileByMediaId.clear();

    for (const media of state.media.list()) {
      const entry = state.sources.getEntry(media.sourceEntryId);
      if (entry) {
        this.setSourceId(media.mediaId, entry.sourceId);
      }
      this.setSha256(media.mediaId, media.sha256);
    }
    for (const { mediaId, metadata } of state.metadata.list()) {
      this.setKind(mediaId, metadata.kind);
      this.setMimeType(mediaId, metadata.mimeType);
      this.setCameraModel(mediaId, metadata.cameraModel);
      this.setTakenAt(mediaId, metadata.takenAt);
      this.setTakenDay(mediaId, metadata.takenAt);
      this.setGpsTile(mediaId, extractGpsTileFromMetadata(metadata));
    }
    for (const link of state.duplicateLinks.list()) {
      this.addDuplicate(link.level, link.mediaId);
      const linkedMedia = state.media.getBySourceEntryId(link.sourceEntryId);
      if (linkedMedia) {
        this.addDuplicate(link.level, linkedMedia.mediaId);
      }
    }
  }

  query(filters: MediaSearchFilters, state: DomainState, sort: MediaSearchSort = "mediaId_asc"): MediaId[] {
    const candidateSets: Array<ReadonlySet<MediaId>> = [];

    if (filters.kind) {
      candidateSets.push(this.kindIndex.get(filters.kind) ?? EMPTY_MEDIA_ID_SET);
    }
    if (filters.mimeType) {
      const normalized = normalizeMimeType(filters.mimeType);
      candidateSets.push(this.mimeTypeIndex.get(normalized) ?? EMPTY_MEDIA_ID_SET);
    }
    if (filters.sourceId) {
      candidateSets.push(this.sourceIdIndex.get(filters.sourceId) ?? EMPTY_MEDIA_ID_SET);
    }
    if (filters.duplicateLevel) {
      candidateSets.push(this.duplicateLevelIndex.get(filters.duplicateLevel) ?? EMPTY_MEDIA_ID_SET);
    }
    if (filters.cameraModel) {
      const normalized = normalizeSearchToken(filters.cameraModel);
      candidateSets.push(this.cameraModelIndex.get(normalized) ?? EMPTY_MEDIA_ID_SET);
    }
    if (filters.takenDay) {
      const normalized = normalizeTakenDay(filters.takenDay);
      candidateSets.push(this.takenDayIndex.get(normalized) ?? EMPTY_MEDIA_ID_SET);
    }
    if (filters.gpsTile) {
      const normalized = normalizeGpsTile(filters.gpsTile);
      candidateSets.push(this.gpsTileIndex.get(normalized) ?? EMPTY_MEDIA_ID_SET);
    }
    if (filters.sha256Prefix) {
      const normalized = normalizeSha256Prefix(filters.sha256Prefix);
      candidateSets.push(this.collectBySha256Prefix(normalized));
    }

    if (candidateSets.length === 0) {
      return sortMediaIds(
        state.media
          .list()
          .map((item) => item.mediaId),
        sort,
        this.takenAtByMediaId
      );
    }

    candidateSets.sort((a, b) => a.size - b.size);
    const [first, ...rest] = candidateSets;
    if (!first || first.size === 0) {
      return [];
    }

    const result: MediaId[] = [];
    outer: for (const mediaId of first) {
      for (const next of rest) {
        if (!next.has(mediaId)) {
          continue outer;
        }
      }
      result.push(mediaId);
    }

    if (result.length === 0) {
      return [];
    }

    return sortMediaIds(result, sort, this.takenAtByMediaId);
  }

  cursorStartIndex(sortedMediaIds: MediaId[], cursor: MediaId, sort: MediaSearchSort): number {
    if (sort === "takenAt_desc" && !this.takenAtByMediaId.has(cursor) && !sortedMediaIds.includes(cursor)) {
      return 0;
    }
    return upperBoundMediaIds(sortedMediaIds, cursor, sort, this.takenAtByMediaId);
  }

  private setKind(mediaId: MediaId, kind: string | undefined): void {
    const previous = this.kindByMediaId.get(mediaId);
    if (previous) {
      removeFromIndex(this.kindIndex, previous, mediaId);
      this.kindByMediaId.delete(mediaId);
    }
    if (!kind) {
      return;
    }
    this.kindByMediaId.set(mediaId, kind);
    addToIndex(this.kindIndex, kind, mediaId);
  }

  private setMimeType(mediaId: MediaId, mimeType: string | undefined): void {
    const previous = this.mimeTypeByMediaId.get(mediaId);
    if (previous) {
      removeFromIndex(this.mimeTypeIndex, previous, mediaId);
      this.mimeTypeByMediaId.delete(mediaId);
    }
    const normalized = normalizeMimeType(mimeType);
    if (!normalized) {
      return;
    }
    this.mimeTypeByMediaId.set(mediaId, normalized);
    addToIndex(this.mimeTypeIndex, normalized, mediaId);
  }

  private setSourceId(mediaId: MediaId, sourceId: SourceId): void {
    const previous = this.sourceIdByMediaId.get(mediaId);
    if (previous) {
      removeFromIndex(this.sourceIdIndex, previous, mediaId);
      this.sourceIdByMediaId.delete(mediaId);
    }
    this.sourceIdByMediaId.set(mediaId, sourceId);
    addToIndex(this.sourceIdIndex, sourceId, mediaId);
  }

  private setSha256(mediaId: MediaId, sha256: string | undefined): void {
    const previous = this.sha256ByMediaId.get(mediaId);
    if (previous) {
      removeFromIndex(this.sha256ExactIndex, previous, mediaId);
      removeFromIndex(this.sha256Prefix2Index, previous.slice(0, 2), mediaId);
      removeFromIndex(this.sha256Prefix4Index, previous.slice(0, 4), mediaId);
      removeFromIndex(this.sha256Prefix8Index, previous.slice(0, 8), mediaId);
      this.sha256ByMediaId.delete(mediaId);
    }

    const normalized = normalizeSha256(sha256);
    if (!normalized) {
      return;
    }

    this.sha256ByMediaId.set(mediaId, normalized);
    addToIndex(this.sha256ExactIndex, normalized, mediaId);
    addToIndex(this.sha256Prefix2Index, normalized.slice(0, 2), mediaId);
    addToIndex(this.sha256Prefix4Index, normalized.slice(0, 4), mediaId);
    addToIndex(this.sha256Prefix8Index, normalized.slice(0, 8), mediaId);
  }

  private collectBySha256Prefix(prefix: string): ReadonlySet<MediaId> {
    if (!prefix) {
      return EMPTY_MEDIA_ID_SET;
    }

    if (prefix.length === 2) {
      return this.sha256Prefix2Index.get(prefix) ?? EMPTY_MEDIA_ID_SET;
    }

    if (prefix.length === 4) {
      return this.sha256Prefix4Index.get(prefix) ?? EMPTY_MEDIA_ID_SET;
    }

    if (prefix.length === 8) {
      return this.sha256Prefix8Index.get(prefix) ?? EMPTY_MEDIA_ID_SET;
    }

    if (prefix.length === 64) {
      return this.sha256ExactIndex.get(prefix) ?? EMPTY_MEDIA_ID_SET;
    }

    if (prefix.length === 3) {
      return filterBySha256Prefix(
        this.sha256Prefix2Index.get(prefix.slice(0, 2)),
        prefix,
        this.sha256ByMediaId
      );
    }

    if (prefix.length >= 5 && prefix.length <= 7) {
      return filterBySha256Prefix(
        this.sha256Prefix4Index.get(prefix.slice(0, 4)),
        prefix,
        this.sha256ByMediaId
      );
    }

    return filterBySha256Prefix(
      this.sha256Prefix8Index.get(prefix.slice(0, 8)),
      prefix,
      this.sha256ByMediaId
    );
  }

  private setCameraModel(mediaId: MediaId, cameraModel: string | undefined): void {
    const previous = this.cameraModelByMediaId.get(mediaId);
    if (previous) {
      removeFromIndex(this.cameraModelIndex, previous, mediaId);
      this.cameraModelByMediaId.delete(mediaId);
    }
    const normalized = normalizeSearchToken(cameraModel);
    if (!normalized) {
      return;
    }
    this.cameraModelByMediaId.set(mediaId, normalized);
    addToIndex(this.cameraModelIndex, normalized, mediaId);
  }

  private setTakenAt(mediaId: MediaId, takenAt: number | undefined): void {
    if (typeof takenAt === "number" && Number.isFinite(takenAt)) {
      this.takenAtByMediaId.set(mediaId, takenAt);
      return;
    }
    this.takenAtByMediaId.delete(mediaId);
  }

  private setTakenDay(mediaId: MediaId, takenAt: number | undefined): void {
    const previous = this.takenDayByMediaId.get(mediaId);
    if (previous) {
      removeFromIndex(this.takenDayIndex, previous, mediaId);
      this.takenDayByMediaId.delete(mediaId);
    }
    const day = takenDayFromTimestamp(takenAt);
    if (!day) {
      return;
    }
    this.takenDayByMediaId.set(mediaId, day);
    addToIndex(this.takenDayIndex, day, mediaId);
  }

  private setGpsTile(mediaId: MediaId, gpsTile: string | undefined): void {
    const previous = this.gpsTileByMediaId.get(mediaId);
    if (previous) {
      removeFromIndex(this.gpsTileIndex, previous, mediaId);
      this.gpsTileByMediaId.delete(mediaId);
    }
    const normalized = normalizeGpsTile(gpsTile);
    if (!normalized) {
      return;
    }
    this.gpsTileByMediaId.set(mediaId, normalized);
    addToIndex(this.gpsTileIndex, normalized, mediaId);
  }

  private addDuplicate(level: DuplicateLink["level"], mediaId: MediaId): void {
    addToIndex(this.duplicateLevelIndex, level, mediaId);
  }
}

export class DomainState {
  readonly sources = new SourceStore();
  readonly media = new MediaStore();
  readonly ingest = new IngestStore();
  readonly metadata = new MediaMetadataStore();
  readonly duplicateLinks = new DuplicateLinkStore();
  readonly quarantine = new QuarantineStore();
  readonly mediaSearch = new MediaSearchIndexStore();

  applyEvent(event: DomainEvent): void {
    this.sources.applyEvent(event);
    this.media.applyEvent(event);
    this.ingest.applyEvent(event);
    this.metadata.applyEvent(event);
    this.duplicateLinks.applyEvent(event);
    this.quarantine.applyEvent(event);
    this.mediaSearch.applyEvent(event, this);
  }

  rebuildIndexes(): void {
    this.mediaSearch.rebuild(this);
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

function addToIndex<TKey>(index: Map<TKey, Set<MediaId>>, key: TKey, mediaId: MediaId): void {
  const bucket = index.get(key) ?? new Set<MediaId>();
  bucket.add(mediaId);
  index.set(key, bucket);
}

function removeFromIndex<TKey>(index: Map<TKey, Set<MediaId>>, key: TKey, mediaId: MediaId): void {
  const bucket = index.get(key);
  if (!bucket) {
    return;
  }
  bucket.delete(mediaId);
  if (bucket.size === 0) {
    index.delete(key);
  }
}

function normalizeMimeType(mimeType: string | undefined): string {
  if (typeof mimeType !== "string") {
    return "";
  }
  return mimeType.trim().toLowerCase();
}

function normalizeSearchToken(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function takenDayFromTimestamp(takenAt: number | undefined): string | undefined {
  if (typeof takenAt !== "number" || !Number.isFinite(takenAt)) {
    return undefined;
  }
  return new Date(takenAt).toISOString().slice(0, 10);
}

function normalizeTakenDay(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeGpsTile(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function normalizeSha256(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : "";
}

function normalizeSha256Prefix(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{2,64}$/.test(normalized) ? normalized : "";
}

function filterBySha256Prefix(
  candidates: ReadonlySet<MediaId> | undefined,
  prefix: string,
  sha256ByMediaId: Map<MediaId, string>
): ReadonlySet<MediaId> {
  if (!candidates || candidates.size === 0) {
    return EMPTY_MEDIA_ID_SET;
  }

  const result = new Set<MediaId>();
  for (const mediaId of candidates) {
    const sha256 = sha256ByMediaId.get(mediaId);
    if (sha256?.startsWith(prefix)) {
      result.add(mediaId);
    }
  }

  return result.size > 0 ? result : EMPTY_MEDIA_ID_SET;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function gpsTileFromCoordinates(lat: number, lon: number): string {
  const latBucket = Math.floor(lat * 10) / 10;
  const lonBucket = Math.floor(lon * 10) / 10;
  return `${latBucket.toFixed(1)}:${lonBucket.toFixed(1)}`;
}

function extractGpsTileFromMetadata(metadata: MediaMetadata): string | undefined {
  const raw = metadata.raw;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const gpsTile = raw.gpsTile;
  if (typeof gpsTile === "string" && gpsTile.trim()) {
    return normalizeGpsTile(gpsTile);
  }

  const lat =
    toFiniteNumber(raw.gpsLatitude) ??
    toFiniteNumber(raw.GPSLatitude) ??
    toFiniteNumber(raw.latitude) ??
    toFiniteNumber(raw.lat);
  const lon =
    toFiniteNumber(raw.gpsLongitude) ??
    toFiniteNumber(raw.GPSLongitude) ??
    toFiniteNumber(raw.longitude) ??
    toFiniteNumber(raw.lon);

  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  return gpsTileFromCoordinates(lat, lon);
}

function sortMediaIds(
  mediaIds: MediaId[],
  sort: MediaSearchSort,
  takenAtByMediaId: Map<MediaId, number>
): MediaId[] {
  return mediaIds.sort((left, right) => compareMediaIdsForSort(left, right, sort, takenAtByMediaId));
}

function upperBoundMediaIds(
  sortedMediaIds: MediaId[],
  cursor: MediaId,
  sort: MediaSearchSort,
  takenAtByMediaId: Map<MediaId, number>
): number {
  let low = 0;
  let high = sortedMediaIds.length;

  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const midMediaId = sortedMediaIds[mid];
    if (!midMediaId) {
      high = mid;
      continue;
    }

    const cmp = compareMediaIdsForSort(midMediaId, cursor, sort, takenAtByMediaId);
    if (cmp <= 0) {
      low = mid + 1;
      continue;
    }
    high = mid;
  }

  return low;
}

function compareMediaIdsForSort(
  left: MediaId,
  right: MediaId,
  sort: MediaSearchSort,
  takenAtByMediaId: Map<MediaId, number>
): number {
  if (sort === "mediaId_asc") {
    return left.localeCompare(right);
  }

  const leftTakenAt = takenAtByMediaId.get(left);
  const rightTakenAt = takenAtByMediaId.get(right);

  if (typeof leftTakenAt === "number" && typeof rightTakenAt === "number") {
    if (rightTakenAt !== leftTakenAt) {
      return rightTakenAt - leftTakenAt;
    }
    return left.localeCompare(right);
  }
  if (typeof leftTakenAt === "number") {
    return -1;
  }
  if (typeof rightTakenAt === "number") {
    return 1;
  }
  return left.localeCompare(right);
}

function normalizePerceptualHash(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(normalized) ? normalized : undefined;
}
