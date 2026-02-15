import { describe, expect, it } from "vitest";
import {
  createEvent,
  newMediaId,
  newQuarantineItemId,
  newSourceEntryId
} from "@family-media-vault/core";
import { DomainState } from "@family-media-vault/storage";
import {
  createQuarantineAcceptJobHandler,
  createQuarantineRejectJobHandler
} from "../quarantine";

describe("quarantine resolution", () => {
  it("accepts quarantine item and creates duplicate link", async () => {
    const state = new DomainState();
    const events: string[] = [];
    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      events.push(event.type);
      state.applyEvent(event);
    };

    const sourceEntryId = newSourceEntryId();
    const mediaA = newMediaId();
    const mediaB = newMediaId();
    const quarantineId = newQuarantineItemId();

    await appendEvent(
      createEvent("QUARANTINE_CREATED", {
        item: {
          quarantineId,
          sourceEntryId,
          candidateMediaIds: [mediaA, mediaB],
          status: "pending",
          createdAt: 1
        }
      })
    );

    const handler = createQuarantineAcceptJobHandler({
      state,
      appendEvent,
      now: () => 1234
    });

    await handler({ payload: { quarantineId, acceptedMediaId: mediaB } });

    const item = state.quarantine.get(quarantineId);
    expect(item?.status).toBe("accepted");
    expect(item?.acceptedMediaId).toBe(mediaB);
    expect(item?.resolvedAt).toBe(1234);
    expect(item?.rejectedReason).toBeUndefined();

    const links = state.duplicateLinks.list();
    expect(links).toHaveLength(1);
    expect(links[0].mediaId).toBe(mediaB);
    expect(links[0].sourceEntryId).toBe(sourceEntryId);
    expect(links[0].level).toBe("probable");
    expect(events).toEqual(["QUARANTINE_CREATED", "QUARANTINE_ACCEPTED", "DUPLICATE_LINK_CREATED"]);
  });

  it("rejects quarantine item with reason", async () => {
    const state = new DomainState();
    const appendEvent = async (event: ReturnType<typeof createEvent>) => {
      state.applyEvent(event);
    };

    const sourceEntryId = newSourceEntryId();
    const mediaA = newMediaId();
    const quarantineId = newQuarantineItemId();

    await appendEvent(
      createEvent("QUARANTINE_CREATED", {
        item: {
          quarantineId,
          sourceEntryId,
          candidateMediaIds: [mediaA],
          status: "pending",
          createdAt: 1
        }
      })
    );

    const handler = createQuarantineRejectJobHandler({
      state,
      appendEvent,
      now: () => 999
    });

    await handler({ payload: { quarantineId, reason: "not a duplicate" } });

    const item = state.quarantine.get(quarantineId);
    expect(item?.status).toBe("rejected");
    expect(item?.rejectedReason).toBe("not a duplicate");
    expect(item?.resolvedAt).toBe(999);
    expect(item?.acceptedMediaId).toBeUndefined();

    expect(state.duplicateLinks.list()).toHaveLength(0);
  });
});
