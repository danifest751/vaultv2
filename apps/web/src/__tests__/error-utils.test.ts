import { describe, expect, it } from "vitest";
import { ApiError } from "../dev-console/api";
import { asErrorMessage } from "../dev-console/shared/error-utils";

describe("asErrorMessage", () => {
  it("returns ApiError message", () => {
    const error = new ApiError("api_failed", 500);

    expect(asErrorMessage(error)).toBe("api_failed");
  });

  it("returns native Error message", () => {
    expect(asErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns unknown_error for non-errors", () => {
    expect(asErrorMessage({ reason: "oops" })).toBe("unknown_error");
  });
});
