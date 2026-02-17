import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../server-config";

describe("loadServerConfig", () => {
  it("loads dedup thresholds from env", () => {
    const config = loadServerConfig({
      WAL_HMAC_SECRET: "secret",
      DERIVED_GENERATE_MAX_ATTEMPTS: "5",
      DEDUP_STRONG_DISTANCE_THRESHOLD: "3",
      DEDUP_PROBABLE_DISTANCE_THRESHOLD: "9"
    });

    expect(config.derivedGenerateMaxAttempts).toBe(5);
    expect(config.dedupStrongDistanceThreshold).toBe(3);
    expect(config.dedupProbableDistanceThreshold).toBe(9);
  });

  it("falls back to defaults for invalid dedup thresholds", () => {
    const config = loadServerConfig({
      WAL_HMAC_SECRET: "secret",
      DEDUP_STRONG_DISTANCE_THRESHOLD: "-10",
      DEDUP_PROBABLE_DISTANCE_THRESHOLD: "nan"
    });

    expect(config.dedupStrongDistanceThreshold).toBe(0);
    expect(config.dedupProbableDistanceThreshold).toBe(10);
  });

  it("normalizes derived attempts to minimum 1 for invalid values", () => {
    const config = loadServerConfig({
      WAL_HMAC_SECRET: "secret",
      DERIVED_GENERATE_MAX_ATTEMPTS: "0"
    });

    expect(config.derivedGenerateMaxAttempts).toBe(1);
  });
});
