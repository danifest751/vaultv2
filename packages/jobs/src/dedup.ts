import {
  JsonObject,
  QuarantineItem,
  asSourceEntryId,
  createEvent,
  newQuarantineItemId
} from "@family-media-vault/core";
import { DomainState } from "@family-media-vault/storage";

export interface DedupProbableOptions {
  state: DomainState;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
  now?: () => number;
}

export function createProbableDedupJobHandler(options: DedupProbableOptions) {
  const now = options.now ?? (() => Date.now());

  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const entryIdRaw = payload.sourceEntryId;
    if (typeof entryIdRaw !== "string") {
      throw new Error("dedup job payload must include sourceEntryId");
    }

    const entryId = asSourceEntryId(entryIdRaw);
    if (options.state.quarantine.getBySourceEntryId(entryId)) {
      return;
    }

    const entry = options.state.sources.getEntry(entryId);
    if (!entry) {
      throw new Error(`Source entry not found: ${entryId}`);
    }

    const status = options.state.ingest.getStatus(entryId);
    if (status.status !== "imported") {
      return;
    }

    const headKey = options.state.sources.getHeadHashKey(entry);
    if (!headKey) {
      return;
    }

    const candidates = options.state.sources.listEntriesByHeadHash(
      headKey.size,
      headKey.headHash
    );

    for (const candidate of candidates) {
      if (candidate.sourceEntryId === entryId) {
        continue;
      }
      if (candidate.state !== "active") {
        continue;
      }
      if (options.state.quarantine.getBySourceEntryId(candidate.sourceEntryId)) {
        return;
      }
    }

    const media = options.state.media.getBySourceEntryId(entryId);
    if (!media) {
      return;
    }

    const candidateMediaIds = new Set([media.mediaId]);
    for (const candidate of candidates) {
      if (candidate.sourceEntryId === entryId) {
        continue;
      }
      if (candidate.state !== "active") {
        continue;
      }
      const candidateStatus = options.state.ingest.getStatus(candidate.sourceEntryId);
      if (candidateStatus.status !== "imported") {
        continue;
      }
      const candidateMedia = options.state.media.getBySourceEntryId(candidate.sourceEntryId);
      if (!candidateMedia) {
        continue;
      }
      candidateMediaIds.add(candidateMedia.mediaId);
    }

    if (candidateMediaIds.size <= 1) {
      return;
    }

    const item: QuarantineItem = {
      quarantineId: newQuarantineItemId(),
      sourceEntryId: entryId,
      candidateMediaIds: Array.from(candidateMediaIds),
      status: "pending",
      createdAt: now()
    };

    await options.appendEvent(createEvent("QUARANTINE_CREATED", { item }));
  };
}
