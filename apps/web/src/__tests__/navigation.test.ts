import { describe, expect, it } from "vitest";
import { NAV_ITEMS, SectionKey } from "../dev-console/navigation";

describe("NAV_ITEMS", () => {
  it("contains unique section keys", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    const uniqueKeys = new Set(keys);

    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("contains all required sections", () => {
    const keys = NAV_ITEMS.map((item) => item.key);
    const expected: SectionKey[] = ["overview", "sources", "media", "albums", "quarantine", "duplicates", "jobs", "system"];

    expect(keys).toEqual(expected);
  });
});
