import { describe, expect, it } from "vitest";
import { getJobStatusColor } from "../dev-console/jobs/job-status-utils";

describe("getJobStatusColor", () => {
  it("maps completed to green", () => {
    expect(getJobStatusColor("completed")).toBe("green");
  });

  it("maps failed to red", () => {
    expect(getJobStatusColor("failed")).toBe("red");
  });

  it("maps running to yellow", () => {
    expect(getJobStatusColor("running")).toBe("yellow");
  });

  it("maps queued to gray", () => {
    expect(getJobStatusColor("queued")).toBe("gray");
  });
});
