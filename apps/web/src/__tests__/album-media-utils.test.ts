import { describe, expect, it } from "vitest";
import { filterAvailableMedia, uniqueMediaIds } from "../dev-console/albums/album-media-utils";
import { MediaDto } from "../dev-console/types";

describe("album media utils", () => {
  it("deduplicates and trims media ids while preserving order", () => {
    const input = [" media-1 ", "media-2", "media-1", "", "   ", "media-3"];

    expect(uniqueMediaIds(input)).toEqual(["media-1", "media-2", "media-3"]);
  });

  it("filters out selected media and applies query with limit", () => {
    const catalog: MediaDto[] = [
      { mediaId: "m1", sha256: "aaaa1111", size: 100, sourceEntryId: "se1" },
      { mediaId: "holiday-2", sha256: "bbbb2222", size: 200, sourceEntryId: "se2" },
      { mediaId: "m3", sha256: "cccc3333", size: 300, sourceEntryId: "se3" }
    ];

    const result = filterAvailableMedia(catalog, ["m1"], "22", 5);

    expect(result).toEqual([{ mediaId: "holiday-2", sha256: "bbbb2222", size: 200, sourceEntryId: "se2" }]);
  });

  it("respects limit after filtering", () => {
    const catalog: MediaDto[] = [
      { mediaId: "m1", sha256: "s1", size: 1, sourceEntryId: "se1" },
      { mediaId: "m2", sha256: "s2", size: 2, sourceEntryId: "se2" },
      { mediaId: "m3", sha256: "s3", size: 3, sourceEntryId: "se3" }
    ];

    const result = filterAvailableMedia(catalog, [], "", 2);

    expect(result.map((item) => item.mediaId)).toEqual(["m1", "m2"]);
  });
});
