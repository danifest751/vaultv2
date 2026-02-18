import { describe, expect, it } from "vitest";
import { computeMediaPageStats } from "../dev-console/media/media-view-utils";

describe("computeMediaPageStats", () => {
  it("returns first page defaults when total is zero", () => {
    const result = computeMediaPageStats(0, 0, 50);

    expect(result).toEqual({
      pageNumber: 1,
      pageCount: 1,
      hasPrev: false,
      hasNext: false
    });
  });

  it("returns correct stats for middle page", () => {
    const result = computeMediaPageStats(250, 100, 50);

    expect(result).toEqual({
      pageNumber: 3,
      pageCount: 5,
      hasPrev: true,
      hasNext: true
    });
  });

  it("sanitizes invalid limit and offset", () => {
    const result = computeMediaPageStats(100, -10, 0);

    expect(result).toEqual({
      pageNumber: 1,
      pageCount: 100,
      hasPrev: false,
      hasNext: true
    });
  });
});
