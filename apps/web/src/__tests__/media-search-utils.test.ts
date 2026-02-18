import { describe, expect, it } from "vitest";
import { hasSearchFilters, toSelectedSet } from "../dev-console/media/media-search-utils";
import { MediaSearchFilters } from "../dev-console/types";

const EMPTY_FILTERS: MediaSearchFilters = {
  kind: "",
  mimeType: "",
  sourceId: "",
  duplicateLevel: "",
  cameraModel: "",
  takenDay: "",
  gpsTile: "",
  sha256Prefix: "",
  sort: "takenAt_desc"
};

describe("hasSearchFilters", () => {
  it("returns false for empty filters", () => {
    expect(hasSearchFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("returns true when any filter is present", () => {
    expect(hasSearchFilters({ ...EMPTY_FILTERS, sourceId: "src-1" })).toBe(true);
    expect(hasSearchFilters({ ...EMPTY_FILTERS, sha256Prefix: "abc" })).toBe(true);
  });
});

describe("toSelectedSet", () => {
  it("builds a set with unique values", () => {
    const result = toSelectedSet(["m1", "m2", "m1"]);

    expect(Array.from(result)).toEqual(["m1", "m2"]);
  });
});
