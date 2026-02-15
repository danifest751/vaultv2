import {
  JsonObject,
  asMediaId,
  asQuarantineItemId,
  createEvent,
  newDuplicateLinkId
} from "@family-media-vault/core";
import { DomainState } from "@family-media-vault/storage";

export interface QuarantineResolutionOptions {
  state: DomainState;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
  now?: () => number;
}

export function createQuarantineAcceptJobHandler(options: QuarantineResolutionOptions) {
  const now = options.now ?? (() => Date.now());

  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const quarantineIdRaw = payload.quarantineId;
    const acceptedMediaIdRaw = payload.acceptedMediaId;
    if (typeof quarantineIdRaw !== "string" || typeof acceptedMediaIdRaw !== "string") {
      throw new Error("quarantine accept payload must include quarantineId and acceptedMediaId");
    }

    const quarantineId = asQuarantineItemId(quarantineIdRaw);
    const acceptedMediaId = asMediaId(acceptedMediaIdRaw);
    const item = options.state.quarantine.get(quarantineId);
    if (!item) {
      throw new Error(`Quarantine item not found: ${quarantineId}`);
    }
    if (item.status !== "pending") {
      return;
    }
    if (!item.candidateMediaIds.includes(acceptedMediaId)) {
      throw new Error(`Accepted mediaId ${acceptedMediaId} not in quarantine candidates`);
    }

    const resolvedAt = now();
    await options.appendEvent(
      createEvent("QUARANTINE_ACCEPTED", {
        quarantineId,
        acceptedMediaId,
        resolvedAt
      })
    );

    await options.appendEvent(
      createEvent("DUPLICATE_LINK_CREATED", {
        link: {
          duplicateLinkId: newDuplicateLinkId(),
          mediaId: acceptedMediaId,
          sourceEntryId: item.sourceEntryId,
          level: "probable",
          createdAt: resolvedAt,
          reason: "quarantine-accepted"
        }
      })
    );
  };
}

export function createQuarantineRejectJobHandler(options: QuarantineResolutionOptions) {
  const now = options.now ?? (() => Date.now());

  return async (context: { payload?: JsonObject }) => {
    const payload = context.payload ?? {};
    const quarantineIdRaw = payload.quarantineId;
    const reasonRaw = payload.reason;
    if (typeof quarantineIdRaw !== "string") {
      throw new Error("quarantine reject payload must include quarantineId");
    }

    const quarantineId = asQuarantineItemId(quarantineIdRaw);
    const item = options.state.quarantine.get(quarantineId);
    if (!item) {
      throw new Error(`Quarantine item not found: ${quarantineId}`);
    }
    if (item.status !== "pending") {
      return;
    }

    const resolvedAt = now();
    const reason = typeof reasonRaw === "string" ? reasonRaw : undefined;

    await options.appendEvent(
      createEvent("QUARANTINE_REJECTED", {
        quarantineId,
        resolvedAt,
        reason
      })
    );
  };
}
