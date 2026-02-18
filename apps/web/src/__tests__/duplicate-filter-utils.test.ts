import { describe, expect, it } from "vitest";
import { normalizeDuplicateLevelFilter } from "../dev-console/duplicates/duplicate-filter-utils";

describe("normalizeDuplicateLevelFilter", () => {
  it("returns allowed values", () => {
    expect(normalizeDuplicateLevelFilter("exact")).toBe("exact");
    expect(normalizeDuplicateLevelFilter("strong")).toBe("strong");
    expect(normalizeDuplicateLevelFilter("probable")).toBe("probable");
  });

  it("returns empty string for clear/null", () => {
    expect(normalizeDuplicateLevelFilter("")).toBe("");
    expect(normalizeDuplicateLevelFilter(null)).toBe("");
    expect(normalizeDuplicateLevelFilter(undefined)).toBe("");
  });

  it("returns empty string for unknown level", () => {
    expect(normalizeDuplicateLevelFilter("foo")).toBe("");
  });
});
