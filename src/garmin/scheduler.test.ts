import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock config
mock.module("../config", () => ({
  config: {
    garminSyncIntervalHours: 4,
    summaryHour: 0, // midnight
    timezone: "UTC",
  },
}));

// Mock sync module
const mockSyncGarmin = mock(() => Promise.resolve());
mock.module("./sync", () => ({
  syncGarmin: mockSyncGarmin,
  getLastSyncTime: () => new Date(Date.now() - 3600000), // 1 hour ago
}));

const { shouldSkipScheduledSync, getNextSyncTime, runScheduledSync } = await import(
  "./scheduler"
);

describe("Garmin Scheduler", () => {
  beforeEach(() => {
    mockSyncGarmin.mockClear();
  });

  test("shouldSkipScheduledSync returns true when EOD is within 1 hour", () => {
    // Mock current time to 23:30 (30 min before midnight)
    const now = new Date("2026-02-03T23:30:00Z");
    expect(shouldSkipScheduledSync(now)).toBe(true);
  });

  test("shouldSkipScheduledSync returns false when EOD is >1 hour away", () => {
    // Mock current time to 20:00 (4 hours before midnight)
    const now = new Date("2026-02-03T20:00:00Z");
    expect(shouldSkipScheduledSync(now)).toBe(false);
  });

  test("getNextSyncTime returns time 4 hours from now", () => {
    const now = new Date("2026-02-03T10:00:00Z");
    const next = getNextSyncTime(now);
    expect(next.getTime() - now.getTime()).toBe(4 * 60 * 60 * 1000);
  });

  test("runScheduledSync calls syncGarmin when not skipping", async () => {
    const now = new Date("2026-02-03T10:00:00Z");
    await runScheduledSync(now);
    expect(mockSyncGarmin).toHaveBeenCalledTimes(1);
  });

  test("runScheduledSync skips sync near EOD", async () => {
    const now = new Date("2026-02-03T23:30:00Z");
    await runScheduledSync(now);
    expect(mockSyncGarmin).not.toHaveBeenCalled();
  });
});
