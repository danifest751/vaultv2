import {
  createEvent,
  JsonObject,
  Media,
  asSourceEntryId,
  newMediaId,
  newDuplicateLinkId
} from "@family-media-vault/core";
import {
  DomainState,
  ensureMediaStored,
  hashFileSha256,
  VaultLayout
} from "@family-media-vault/storage";

export interface IngestHandlerOptions {
  state: DomainState;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
  vault: VaultLayout;
}

export function createIngestJobHandler(options: IngestHandlerOptions) {
  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const entryIdRaw = payload.sourceEntryId;
    if (typeof entryIdRaw !== "string") {
      throw new Error("ingest job payload must include sourceEntryId");
    }

    const entryId = asSourceEntryId(entryIdRaw);
    const entry = options.state.sources.getEntry(entryId);
    if (!entry || !entry.path) {
      throw new Error(`Source entry not found: ${entryId}`);
    }

    const status = options.state.ingest.getStatus(entryId);
    if (status.status !== "none") {
      return;
    }

    const sha256 = await hashFileSha256(entry.path);
    await options.appendEvent(
      createEvent("MEDIA_SHA256_COMPUTED", {
        sourceEntryId: entryId,
        sha256,
        size: entry.size
      })
    );
    const existing = options.state.media.getBySha256(sha256);
    if (existing) {
      const duplicateLinkId = newDuplicateLinkId();
      await options.appendEvent(
        createEvent("MEDIA_SKIPPED_DUPLICATE_EXACT", {
          sourceEntryId: entryId,
          existingMediaId: existing.mediaId
        })
      );
      await options.appendEvent(
        createEvent("DUPLICATE_LINK_CREATED", {
          link: {
            duplicateLinkId,
            mediaId: existing.mediaId,
            sourceEntryId: entryId,
            level: "exact",
            createdAt: Date.now(),
            reason: "sha256"
          }
        })
      );
      return;
    }

    await ensureMediaStored(options.vault, entry.path, sha256);

    const media: Media = {
      mediaId: newMediaId(),
      sha256,
      size: entry.size,
      sourceEntryId: entryId
    };

    await options.appendEvent(createEvent("MEDIA_IMPORTED", { media }));
  };
}
