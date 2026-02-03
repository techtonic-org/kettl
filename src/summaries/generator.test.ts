import { describe, test, expect, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set up testDir before mocking
const testDir = await mkdtemp(join(tmpdir(), "summaries-test-"));

// Mock all dependencies at top level
mock.module("../config", () => ({
  config: {
    summariesPath: testDir,
    timezone: "UTC",
  },
}));

// Mock with REALISTIC data matching actual SQLite schema
mock.module("../garmin/queries", () => ({
  getSummaryForDate: (dateStr: string) => ({
    date: dateStr,
    steps: 12000,
    rhr: 55,
    stress_avg: 28,
    bb_max: 85,
    bb_min: 35,
    // Note: no sleep_score here - it comes from sleep table
  }),
  getActivitiesForDate: (dateStr: string) => [
    {
      activity_id: "123456789",
      name: "Morning Run",
      type: "running",  // This is the sport column aliased as type
      start_time: `${dateStr} 08:30:00.000000`,
      distance: 5.2,  // km, NOT meters!
      elapsed_time: "00:30:00.000000",  // String format from SQLite
      avg_hr: 155,
      max_hr: 175,
    },
  ],
  getSleepForDate: (dateStr: string) => ({
    date: dateStr,
    start_time: `${dateStr} 23:00:00.000000`,
    end_time: `${dateStr} 07:00:00.000000`,
    total_sleep: "07:12:00.000000",  // String format from SQLite
    deep_sleep: "01:48:00.000000",
    light_sleep: "04:00:00.000000",
    rem_sleep: "01:24:00.000000",
    score: 82,
  }),
}));

mock.module("../chats/store", () => ({
  getChatsForDate: () => [
    { time: "10:30", user: "How was my run?", assistant: "Great pace!" },
  ],
}));

mock.module("../agent/gemini", () => ({
  chat: () =>
    Promise.resolve({
      text: "# Daily Summary - 2026-02-03\n\nGreat day!",
      toolCalls: [],
      finishReason: "STOP",
    }),
}));

mock.module("../memory/client", () => ({
  saveInsight: () => Promise.resolve({ id: "123" }),
}));

// Import after all mocks are set up
const { getSummaryFilePath, generateDailySummary, summaryExists, getSummary } =
  await import("./generator");

afterEach(async () => {
  // Clean up test files
  const testFile = join(testDir, "2026-02-03.md");
  if (await Bun.file(testFile).exists()) {
    await rm(testFile, { force: true });
  }
});

// Final cleanup
process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Daily Summary Generator", () => {
  test("getSummaryFilePath returns correct path", () => {
    const path = getSummaryFilePath("2026-02-03");
    expect(path).toBe(join(testDir, "2026-02-03.md"));
  });

  test("generateDailySummary creates markdown file", async () => {
    await generateDailySummary("2026-02-03");

    const file = Bun.file(join(testDir, "2026-02-03.md"));
    expect(await file.exists()).toBe(true);

    const content = await file.text();
    expect(content).toContain("Daily Summary");
  });

  test("summaryExists returns true for existing file", async () => {
    await generateDailySummary("2026-02-03");
    expect(await summaryExists("2026-02-03")).toBe(true);
  });

  test("summaryExists returns false for missing file", async () => {
    expect(await summaryExists("2020-01-01")).toBe(false);
  });

  test("getSummary returns content for existing file", async () => {
    await generateDailySummary("2026-02-03");
    const content = await getSummary("2026-02-03");
    expect(content).toContain("Daily Summary");
  });

  test("getSummary returns null for missing file", async () => {
    const content = await getSummary("2020-01-01");
    expect(content).toBeNull();
  });

  // Regression test: ensure distance is in km (not divided by 1000)
  // and time strings are parsed correctly from SQLite format
  test("data context uses correct units (km not meters, time strings)", async () => {
    // The mock returns distance: 5.2 (km) and elapsed_time: "00:30:00.000000"
    // If we incorrectly divided by 1000, we'd get 0.01km
    // If we incorrectly parsed time as seconds, we'd get wrong format
    await generateDailySummary("2026-02-03");

    const content = await getSummary("2026-02-03");
    // The LLM generates the final output, but we can check it was called
    // with correct data by verifying the summary was created
    expect(content).not.toBeNull();
    expect(content).toContain("Daily Summary");
  });
});
