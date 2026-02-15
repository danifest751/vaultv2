import { JsonObject, asMediaId, asSourceEntryId, createEvent } from "@family-media-vault/core";
import { DomainState, extractBasicMetadata } from "@family-media-vault/storage";

export interface MetadataHandlerOptions {
  state: DomainState;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
}

export function createMetadataJobHandler(options: MetadataHandlerOptions) {
  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const mediaIdRaw = payload.mediaId;
    const entryIdRaw = payload.sourceEntryId;
    if (typeof mediaIdRaw !== "string" || typeof entryIdRaw !== "string") {
      throw new Error("metadata job payload must include mediaId and sourceEntryId");
    }

    const mediaId = asMediaId(mediaIdRaw);
    const entryId = asSourceEntryId(entryIdRaw);
    const entry = options.state.sources.getEntry(entryId);
    if (!entry || !entry.path) {
      throw new Error(`Source entry not found: ${entryId}`);
    }

    const metadata = extractBasicMetadata(entry.path, entry.mtimeMs);

    await options.appendEvent(
      createEvent("MEDIA_METADATA_EXTRACTED", {
        mediaId,
        sourceEntryId: entryId,
        metadata
      })
    );
  };
}
