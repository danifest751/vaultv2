import { randomUUID } from "node:crypto";
import { assertNonEmptyString } from "./invariants";

export type Branded<T, B extends string> = T & { readonly __brand: B };

export type EventId = Branded<string, "EventId">;
export type JobId = Branded<string, "JobId">;
export type SourceId = Branded<string, "SourceId">;
export type SourceEntryId = Branded<string, "SourceEntryId">;
export type MediaId = Branded<string, "MediaId">;
export type DuplicateLinkId = Branded<string, "DuplicateLinkId">;
export type QuarantineItemId = Branded<string, "QuarantineItemId">;
export type AlbumId = Branded<string, "AlbumId">;

export function brandId<B extends string>(value: string, label: B): Branded<string, B> {
  assertNonEmptyString(value, label);
  return value as Branded<string, B>;
}

function newBranded<B extends string>(label: B, prefix: string): Branded<string, B> {
  return brandId(`${prefix}_${randomUUID()}`, label);
}

export const newEventId = (): EventId => newBranded("EventId", "evt");
export const newJobId = (): JobId => newBranded("JobId", "job");
export const newSourceId = (): SourceId => newBranded("SourceId", "src");
export const newSourceEntryId = (): SourceEntryId => newBranded("SourceEntryId", "se");
export const newMediaId = (): MediaId => newBranded("MediaId", "med");
export const newDuplicateLinkId = (): DuplicateLinkId => newBranded("DuplicateLinkId", "dup");
export const newQuarantineItemId = (): QuarantineItemId => newBranded("QuarantineItemId", "qua");
export const newAlbumId = (): AlbumId => newBranded("AlbumId", "alb");

export const asEventId = (value: string): EventId => brandId(value, "EventId");
export const asJobId = (value: string): JobId => brandId(value, "JobId");
export const asSourceId = (value: string): SourceId => brandId(value, "SourceId");
export const asSourceEntryId = (value: string): SourceEntryId => brandId(value, "SourceEntryId");
export const asMediaId = (value: string): MediaId => brandId(value, "MediaId");
export const asDuplicateLinkId = (value: string): DuplicateLinkId =>
  brandId(value, "DuplicateLinkId");
export const asQuarantineItemId = (value: string): QuarantineItemId =>
  brandId(value, "QuarantineItemId");
export const asAlbumId = (value: string): AlbumId => brandId(value, "AlbumId");
