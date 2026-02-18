export interface MediaPageStats {
  pageNumber: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function computeMediaPageStats(total: number, offset: number, limit: number): MediaPageStats {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeLimit));
  const pageNumber = Math.floor(safeOffset / safeLimit) + 1;

  return {
    pageNumber,
    pageCount,
    hasPrev: safeOffset > 0,
    hasNext: safeOffset + safeLimit < safeTotal
  };
}
