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

mock.module("../garmin/queries", () => ({
  getTodaysSummary: () => ({
    date: "2026-02-03",
    steps: 12000,
    rhr: 55,
    stress_avg: 28,
    bb_max: 85,
    bb_min: 35,
    sleep_score: 82,
  }),
  getRecentActivities: () => [
    {
      activity_id: 1,
      name: "Morning Run",
      type: "running",
      distance: 5200,
      elapsed_time: 1800,
      avg_hr: 155,
      max_hr: 175,
    },
  ],
  getSleepTrend: () => [
    {
      date: "2026-02-03",
      total_sleep: 25920,
      deep_sleep: 6480,
      light_sleep: 14400,
      rem_sleep: 5040,
      score: 82,
    },
  ],
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
});
