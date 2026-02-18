import { MediaDto } from "../types";

export function uniqueMediaIds(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function filterAvailableMedia(
  catalog: MediaDto[],
  selectedMediaIds: string[],
  query: string,
  limit: number
): MediaDto[] {
  const selected = new Set(selectedMediaIds);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered: MediaDto[] = [];

  for (const item of catalog) {
    if (selected.has(item.mediaId)) {
      continue;
    }
    if (normalizedQuery) {
      const inMediaId = item.mediaId.toLowerCase().includes(normalizedQuery);
      const inSha = item.sha256.toLowerCase().includes(normalizedQuery);
      if (!inMediaId && !inSha) {
        continue;
      }
    }
    filtered.push(item);
    if (filtered.length >= limit) {
      break;
    }
  }

  return filtered;
}
