import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../server-config";

describe("loadServerConfig", () => {
  it("loads dedup thresholds from env", () => {
    const config = loadServerConfig({
      WAL_HMAC_SECRET: "secret",
      JOB_CONCURRENCY_TOTAL: "8",
      JOB_CONCURRENCY_IO: "3",
      JOB_CONCURRENCY_CPU: "4",
      JOB_CONCURRENCY_CONTROL: "2",
      DERIVED_GENERATE_MAX_ATTEMPTS: "5",
      DEDUP_STRONG_DISTANCE_THRESHOLD: "3",
      DEDUP_PROBABLE_DISTANCE_THRESHOLD: "9"
    });

    expect(config.jobConcurrencyTotal).toBe(8);
    expect(config.jobConcurrencyIo).toBe(3);
    expect(config.jobConcurrencyCpu).toBe(4);
    expect(config.jobConcurrencyControl).toBe(2);
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
      JOB_CONCURRENCY_TOTAL: "-10",
      JOB_CONCURRENCY_IO: "0",
      JOB_CONCURRENCY_CPU: "nan",
      JOB_CONCURRENCY_CONTROL: "",
      DERIVED_GENERATE_MAX_ATTEMPTS: "0"
    });

    expect(config.jobConcurrencyTotal).toBe(1);
    expect(config.jobConcurrencyIo).toBe(1);
    expect(config.jobConcurrencyCpu).toBe(2);
    expect(config.jobConcurrencyControl).toBe(1);
    expect(config.derivedGenerateMaxAttempts).toBe(1);
  });
});
