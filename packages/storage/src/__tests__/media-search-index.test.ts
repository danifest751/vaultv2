import { describe, expect, it } from "vitest";
import {
  createEvent,
  newMediaId,
  newSourceEntryId,
  newSourceId
} from "@family-media-vault/core";
import { DomainState } from "../state";

interface PrefixCase {
  prefix: string;
  expected: Set<string>;
}

function buildState(): { state: DomainState; mediaIdA: string; mediaIdB: string; mediaIdC: string; sha256A: string } {
  const state = new DomainState();
  const sourceId = newSourceId();
  const sourceEntryIdA = newSourceEntryId();
  const sourceEntryIdB = newSourceEntryId();
  const sourceEntryIdC = newSourceEntryId();
  const mediaIdA = newMediaId();
  const mediaIdB = newMediaId();
  const mediaIdC = newMediaId();

  const sha256A = "abcdefff".repeat(8);
  const sha256B = "abf01234".repeat(8);
  const sha256C = "deadbeef".repeat(8);

  state.applyEvent(
    createEvent("SOURCE_CREATED", {
      source: {
        sourceId,
        path: "C:/tmp/source",
        recursive: true,
        includeArchives: false,
        excludeGlobs: [],
        createdAt: Date.now()
      }
    })
  );

  for (const entry of [
    { sourceEntryId: sourceEntryIdA, path: "C:/tmp/source/a.jpg", size: 11, fingerprint: "11:1:head-a" },
    { sourceEntryId: sourceEntryIdB, path: "C:/tmp/source/b.jpg", size: 12, fingerprint: "12:1:head-b" },
    { sourceEntryId: sourceEntryIdC, path: "C:/tmp/source/c.jpg", size: 13, fingerprint: "13:1:head-c" }
  ]) {
    state.applyEvent(
      createEvent("SOURCE_ENTRY_UPSERTED", {
        entry: {
          sourceEntryId: entry.sourceEntryId,
          sourceId,
          kind: "file",
          path: entry.path,
          size: entry.size,
          mtimeMs: Date.now(),
          fingerprint: entry.fingerprint,
          lastSeenAt: Date.now(),
          state: "active"
        }
      })
    );
  }

  for (const media of [
    { mediaId: mediaIdA, sourceEntryId: sourceEntryIdA, sha256: sha256A, size: 11 },
    { mediaId: mediaIdB, sourceEntryId: sourceEntryIdB, sha256: sha256B, size: 12 },
    { mediaId: mediaIdC, sourceEntryId: sourceEntryIdC, sha256: sha256C, size: 13 }
  ]) {
    state.applyEvent(
      createEvent("MEDIA_IMPORTED", {
        media
      })
    );
  }

  return { state, mediaIdA, mediaIdB, mediaIdC, sha256A };
}

function assertSha256PrefixCases(state: DomainState, cases: PrefixCase[]): void {
  for (const testCase of cases) {
    expect(new Set(state.mediaSearch.query({ sha256Prefix: testCase.prefix }, state))).toEqual(testCase.expected);
  }
}

describe("MediaSearchIndexStore sha256 prefix", () => {
  it("supports all sha256 prefix length buckets before and after rebuild", () => {
    const { state, mediaIdA, mediaIdB, mediaIdC, sha256A } = buildState();

    const cases: PrefixCase[] = [
      { prefix: "AB", expected: new Set([mediaIdA, mediaIdB]) },
      { prefix: "ABC", expected: new Set([mediaIdA]) },
      { prefix: "ABCD", expected: new Set([mediaIdA]) },
      { prefix: "ABCDE", expected: new Set([mediaIdA]) },
      { prefix: "ABCDEFF", expected: new Set([mediaIdA]) },
      { prefix: "ABCDEFFF", expected: new Set([mediaIdA]) },
      { prefix: "ABCDEFFFA", expected: new Set([mediaIdA]) },
      { prefix: sha256A.toUpperCase(), expected: new Set([mediaIdA]) },
      { prefix: "f".repeat(64), expected: new Set() },
      { prefix: "ABF01", expected: new Set([mediaIdB]) },
      { prefix: "DE", expected: new Set([mediaIdC]) },
      { prefix: "A", expected: new Set() },
      { prefix: "ZZZ", expected: new Set() }
    ];

    assertSha256PrefixCases(state, cases);

    state.rebuildIndexes();

    assertSha256PrefixCases(state, cases);
  });
});
