import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "backfill-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// Mock config
mock.module("../config", () => ({
  config: {
    summariesPath: testDir,
    timezone: "UTC",
  },
}));

// Mock generator
const mockGenerateSummary = mock(() => Promise.resolve("# Summary"));
mock.module("./generator", () => ({
  generateDailySummary: mockGenerateSummary,
  summaryExists: async (date: string) => {
    const file = Bun.file(join(testDir, `${date}.md`));
    return await file.exists();
  },
}));

const { getMissingDates, runBackfill } = await import("./backfill");

describe("Summary Backfill", () => {
  beforeEach(() => {
    mockGenerateSummary.mockClear();
  });

  test("getMissingDates returns dates without summaries", async () => {
    // Create one existing summary
    await Bun.write(join(testDir, "2026-02-01.md"), "# Existing");

    const missing = await getMissingDates(
      new Date("2026-02-01"),
      new Date("2026-02-03")
    );

    expect(missing).toEqual(["2026-02-02", "2026-02-03"]);
  });

  test("runBackfill generates missing summaries", async () => {
    await runBackfill(new Date("2026-02-01"), new Date("2026-02-02"), { delayMs: 0 });

    expect(mockGenerateSummary).toHaveBeenCalledTimes(2);
  });

  test("runBackfill skips existing summaries", async () => {
    await Bun.write(join(testDir, "2026-02-01.md"), "# Existing");

    await runBackfill(new Date("2026-02-01"), new Date("2026-02-02"), { delayMs: 0 });

    // Should only generate for 2026-02-02
    expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
    expect(mockGenerateSummary).toHaveBeenCalledWith("2026-02-02");
  });
});
