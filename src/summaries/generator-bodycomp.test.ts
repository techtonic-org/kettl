import { describe, test, expect, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "summaries-bodycomp-test-"));

mock.module("../config", () => ({
  config: {
    summariesPath: testDir,
    timezone: "UTC",
  },
}));

mock.module("../garmin/queries", () => ({
  getSummaryForDate: () => ({
    date: "2026-02-03",
    steps: 12000,
    rhr: 55,
    stress_avg: 28,
    bb_max: 85,
    bb_min: 35,
  }),
  getActivitiesForDate: () => [],
  getSleepForDate: () => ({
    total_sleep: "07:12:00.000000",
    deep_sleep: "01:48:00.000000",
    light_sleep: "04:00:00.000000",
    rem_sleep: "01:24:00.000000",
    score: 82,
  }),
}));

mock.module("../chats/store", () => ({
  getChatsForDate: () => [],
}));

// Track what gets passed to the LLM
let capturedDataContext = "";
mock.module("../agent/gemini", () => ({
  chat: (messages: any[]) => {
    capturedDataContext = messages[0]?.parts?.[0]?.text ?? "";
    return Promise.resolve({
      text: "# Daily Summary - 2026-02-03\n\nGreat day!",
      toolCalls: [],
      finishReason: "STOP",
    });
  },
}));

mock.module("../memory/client", () => ({
  saveInsight: () => Promise.resolve({ id: "123" }),
}));

// Mock Withings adapter for body composition
const mockGetForDate = mock(() =>
  Promise.resolve([
    {
      date: "2026-02-03",
      time: "08:30",
      weight: 80.1,
      fatPercent: 18.2,
      muscleMass: 36.4,
      boneMass: 3.2,
      waterPercent: 55.1,
      bmi: 24.3,
    },
  ])
);

const mockGetLatest = mock(() =>
  Promise.resolve({
    date: "2026-02-02",
    time: "07:45",
    weight: 80.5,
    fatPercent: 18.5,
    muscleMass: 36.2,
    boneMass: 3.2,
    waterPercent: 54.8,
    bmi: 24.4,
  })
);

mock.module("../adapters/withings", () => ({
  withingsAdapter: {
    getForDate: mockGetForDate,
    getLatest: mockGetLatest,
    getTrend: mock(() => Promise.resolve([])),
  },
}));

const { generateDailySummary } = await import("./generator");

afterEach(async () => {
  const testFile = join(testDir, "2026-02-03.md");
  if (await Bun.file(testFile).exists()) {
    await rm(testFile, { force: true });
  }
  capturedDataContext = "";
  mockGetForDate.mockClear();
  mockGetLatest.mockClear();
});

process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Daily Summary Generator - Body Composition Integration", () => {
  test("includes BODY COMPOSITION section in data context", async () => {
    await generateDailySummary("2026-02-03", { overwrite: true });

    expect(capturedDataContext).toContain("BODY COMPOSITION");
    expect(capturedDataContext).toContain("Weight: 80.1 kg");
    expect(capturedDataContext).toContain("Fat: 18.2%");
    expect(capturedDataContext).toContain("Muscle Mass: 36.4 kg");
    expect(capturedDataContext).toContain("Bone Mass: 3.2 kg");
    expect(capturedDataContext).toContain("Water: 55.1%");
    expect(capturedDataContext).toContain("BMI: 24.3");
  });

  test("calls getForDate with the summary date", async () => {
    await generateDailySummary("2026-02-03", { overwrite: true });

    expect(mockGetForDate).toHaveBeenCalledWith("2026-02-03");
  });

  test("falls back to getLatest when no same-day measurement", async () => {
    mockGetForDate.mockImplementation(() => Promise.resolve([]));

    await generateDailySummary("2026-02-03", { overwrite: true });

    expect(mockGetLatest).toHaveBeenCalledTimes(1);
    expect(capturedDataContext).toContain("BODY COMPOSITION");
    expect(capturedDataContext).toContain("Weight: 80.5 kg");
    expect(capturedDataContext).toContain("latest, from 2026-02-02");
  });

  test("handles body composition failure gracefully", async () => {
    mockGetForDate.mockImplementation(() => Promise.reject(new Error("API error")));
    mockGetLatest.mockImplementation(() => Promise.reject(new Error("API error")));

    // Should not throw
    await generateDailySummary("2026-02-03", { overwrite: true });

    expect(capturedDataContext).toContain("BODY COMPOSITION");
    expect(capturedDataContext).toContain("No body composition data");
  });
});
