import {
  JsonObject,
  QuarantineItem,
  asSourceEntryId,
  createEvent,
  newDuplicateLinkId,
  newQuarantineItemId
} from "@family-media-vault/core";
import { DomainState } from "@family-media-vault/storage";

export interface DedupProbableOptions {
  state: DomainState;
  appendEvent: (event: ReturnType<typeof createEvent>) => Promise<void>;
  now?: () => number;
  strongDistanceThreshold?: number;
  probableDistanceThreshold?: number;
}

export function createProbableDedupJobHandler(options: DedupProbableOptions) {
  const now = options.now ?? (() => Date.now());
  const strongDistanceThreshold = normalizeDistanceThreshold(options.strongDistanceThreshold, 4);
  const perceptualDistanceThreshold = normalizeDistanceThreshold(options.probableDistanceThreshold, 10);
  const effectiveProbableDistanceThreshold = Math.max(strongDistanceThreshold, perceptualDistanceThreshold);

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
    const media = options.state.media.getBySourceEntryId(entryId);
    if (!media) {
      return;
    }

    const sourcePerceptualHash = options.state.metadata.getPerceptualHash(media.mediaId);
    const candidateEntryIds = new Set<ReturnType<typeof asSourceEntryId>>();

    if (headKey) {
      const headCandidates = options.state.sources.listEntriesByHeadHash(headKey.size, headKey.headHash);
      for (const candidate of headCandidates) {
        candidateEntryIds.add(candidate.sourceEntryId);
      }
    }

    if (sourcePerceptualHash) {
      const perceptualCandidates = options.state.metadata.listMediaIdsByPerceptualHashPrefix(sourcePerceptualHash);
      for (const mediaId of perceptualCandidates) {
        const candidateMedia = options.state.media.get(mediaId);
        if (candidateMedia) {
          candidateEntryIds.add(candidateMedia.sourceEntryId);
        }
      }
    }

    if (candidateEntryIds.size === 0) {
      return;
    }

    const candidates = Array.from(candidateEntryIds)
      .map((candidateEntryId) => options.state.sources.getEntry(candidateEntryId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

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

    const candidateMediaIds = new Set([media.mediaId]);
    let bestStrongCandidate: { mediaId: typeof media.mediaId; distance: number } | null = null;
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

      if (sourcePerceptualHash) {
        const candidatePerceptualHash = options.state.metadata.getPerceptualHash(candidateMedia.mediaId);
        if (!candidatePerceptualHash) {
          continue;
        }
        const distance = hammingDistanceHex(sourcePerceptualHash, candidatePerceptualHash);
        if (distance === null || distance > effectiveProbableDistanceThreshold) {
          continue;
        }

        if (distance <= strongDistanceThreshold) {
          if (!bestStrongCandidate || distance < bestStrongCandidate.distance) {
            bestStrongCandidate = { mediaId: candidateMedia.mediaId, distance };
          }
        }
      }

      candidateMediaIds.add(candidateMedia.mediaId);
    }

    if (bestStrongCandidate) {
      if (options.state.duplicateLinks.hasForSourceEntry(entryId, "strong")) {
        return;
      }
      if (!options.state.duplicateLinks.has(bestStrongCandidate.mediaId, entryId, "strong")) {
        await options.appendEvent(
          createEvent("DUPLICATE_LINK_CREATED", {
            link: {
              duplicateLinkId: newDuplicateLinkId(),
              mediaId: bestStrongCandidate.mediaId,
              sourceEntryId: entryId,
              level: "strong",
              createdAt: now(),
              reason: `perceptual-hamming<=${strongDistanceThreshold}:${bestStrongCandidate.distance}`
            }
          })
        );
      }
      return;
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

function normalizeDistanceThreshold(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function hammingDistanceHex(a: string, b: string): number | null {
  if (a.length !== b.length || a.length === 0) {
    return null;
  }
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const left = Number.parseInt(a.charAt(i), 16);
    const right = Number.parseInt(b.charAt(i), 16);
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return null;
    }
    distance += nibblePopcount(left ^ right);
  }
  return distance;
}

function nibblePopcount(value: number): number {
  switch (value & 0xf) {
    case 0:
      return 0;
    case 1:
    case 2:
    case 4:
    case 8:
      return 1;
    case 3:
    case 5:
    case 6:
    case 9:
    case 10:
    case 12:
      return 2;
    case 7:
    case 11:
    case 13:
    case 14:
      return 3;
    default:
      return 4;
  }
}
