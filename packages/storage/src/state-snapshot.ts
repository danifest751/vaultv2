import {
  Album,
  DuplicateLink,
  Media,
  MediaId,
  MediaMetadata,
  QuarantineItem,
  Source,
  SourceEntry,
  SourceEntryId
} from "@family-media-vault/core";
import { DomainState, IngestStatus } from "./state";

export type DomainSnapshotRecord =
  | { kind: "album"; album: Album }
  | { kind: "duplicateLink"; link: DuplicateLink }
  | { kind: "source"; source: Source }
  | { kind: "sourceEntry"; entry: SourceEntry }
  | { kind: "media"; media: Media }
  | { kind: "ingestStatus"; sourceEntryId: SourceEntryId; status: IngestStatus }
  | { kind: "metadata"; mediaId: MediaId; metadata: MediaMetadata }
  | { kind: "quarantine"; item: QuarantineItem };

export function* snapshotDomainState(state: DomainState): Iterable<DomainSnapshotRecord> {
  for (const album of state.albums.list()) {
    yield { kind: "album", album };
  }
  for (const source of state.sources.listSources()) {
    yield { kind: "source", source };
  }
  for (const entry of state.sources.listEntries()) {
    yield { kind: "sourceEntry", entry };
  }
  for (const link of state.duplicateLinks.list()) {
    yield { kind: "duplicateLink", link };
  }
  for (const media of state.media.list()) {
    yield { kind: "media", media };
  }
  for (const { sourceEntryId, status } of state.ingest.listStatuses()) {
    yield { kind: "ingestStatus", sourceEntryId, status };
  }
  for (const { mediaId, metadata } of state.metadata.list()) {
    yield { kind: "metadata", mediaId, metadata };
  }
  for (const item of state.quarantine.list()) {
    yield { kind: "quarantine", item };
  }
}

export async function rebuildDomainStateFromSnapshot(
  records: Iterable<DomainSnapshotRecord> | AsyncIterable<DomainSnapshotRecord>
): Promise<DomainState> {
  const state = new DomainState();
  if (Symbol.asyncIterator in records) {
    for await (const record of records as AsyncIterable<DomainSnapshotRecord>) {
      applySnapshotRecord(state, record);
    }
  } else {
    for (const record of records as Iterable<DomainSnapshotRecord>) {
      applySnapshotRecord(state, record);
    }
  }
  state.rebuildIndexes();
  return state;
}

function applySnapshotRecord(state: DomainState, record: DomainSnapshotRecord): void {
  switch (record.kind) {
    case "album":
      state.albums.set(record.album);
      return;
    case "duplicateLink":
      state.duplicateLinks.set(record.link);
      return;
    case "source":
      state.sources.upsertSource(record.source);
      return;
    case "sourceEntry":
      state.sources.upsertEntry(record.entry);
      return;
    case "media":
      state.media.upsertMedia(record.media);
      return;
    case "ingestStatus":
      state.ingest.setStatus(record.sourceEntryId, record.status);
      return;
    case "metadata":
      state.metadata.set(record.mediaId, record.metadata);
      return;
    case "quarantine":
      state.quarantine.set(record.item);
      return;
    default: {
      const _exhaustive: never = record;
      return _exhaustive;
    }
  }
}
