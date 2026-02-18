import { MediaSearchFilters } from "../types";

export function hasSearchFilters(filters: MediaSearchFilters): boolean {
  return Boolean(
    filters.kind ||
      filters.mimeType ||
      filters.sourceId ||
      filters.duplicateLevel ||
      filters.cameraModel ||
      filters.takenDay ||
      filters.gpsTile ||
      filters.sha256Prefix
  );
}

export function toSelectedSet(values: string[]): Set<string> {
  return new Set(values);
}
