import { describe, expect, it } from "vitest";
import { formatBytes, formatDate } from "../dev-console/shared/format-utils";

describe("formatBytes", () => {
  it("returns dash for non-finite values", () => {
    expect(formatBytes(Number.NaN)).toBe("-");
  });

  it("formats bytes below 1KB", () => {
    expect(formatBytes(999)).toBe("999 B");
  });

  it("formats bytes in KB", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("formatDate", () => {
  it("returns dash when value is missing", () => {
    expect(formatDate(undefined)).toBe("-");
  });

  it("returns formatted string when timestamp exists", () => {
    const result = formatDate(1700000000000);

    expect(result).not.toBe("-");
    expect(result.length).toBeGreaterThan(0);
  });
});
