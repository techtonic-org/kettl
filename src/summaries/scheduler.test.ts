import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock config
mock.module("../config", () => ({
  config: {
    summaryHour: 0,
    timezone: "UTC",
  },
}));

// Mock sync
const mockSyncGarmin = mock(() => Promise.resolve());
mock.module("../garmin/sync", () => ({
  syncGarmin: mockSyncGarmin,
}));

// Mock generator
const mockGenerateSummary = mock(() => Promise.resolve("# Summary"));
mock.module("./generator", () => ({
  generateDailySummary: mockGenerateSummary,
}));

const { getMillisecondsToNextSummary, runEodSummary } = await import(
  "./scheduler"
);

describe("Summary Scheduler", () => {
  beforeEach(() => {
    mockSyncGarmin.mockClear();
    mockGenerateSummary.mockClear();
  });

  test("getMillisecondsToNextSummary calculates correctly", () => {
    // At 22:00, next summary at 00:00 = 2 hours
    const now = new Date("2026-02-03T22:00:00Z");
    const ms = getMillisecondsToNextSummary(now);
    expect(ms).toBe(2 * 60 * 60 * 1000);
  });

  test("getMillisecondsToNextSummary handles past summary hour", () => {
    // At 01:00, next summary at 00:00 tomorrow = 23 hours
    const now = new Date("2026-02-03T01:00:00Z");
    const ms = getMillisecondsToNextSummary(now);
    expect(ms).toBe(23 * 60 * 60 * 1000);
  });

  test("runEodSummary syncs then generates summary", async () => {
    await runEodSummary();

    // Verify sync was called first
    expect(mockSyncGarmin).toHaveBeenCalledTimes(1);

    // Verify summary was generated for yesterday
    expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
  });
});
