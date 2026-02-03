import { describe, test, expect, mock, beforeEach } from "bun:test";
import { toolRegistry } from "./registry";

// Mock the instant module
mock.module("../garmin/instant", () => ({
  getCurrentVitals: mock(() =>
    Promise.resolve({
      steps: 10000,
      restingHr: 58,
      stressLevel: 30,
      bodyBatteryHigh: 85,
      bodyBatteryLow: 40,
    })
  ),
  getLatestActivities: mock(() =>
    Promise.resolve([
      {
        activityId: 1,
        activityName: "Morning Run",
        activityType: "running",
        startTimeLocal: "2026-02-03T07:00:00",
        distance: 5000,
        duration: 1800,
        averageHR: 155,
      },
    ])
  ),
  getTodaysSleep: mock(() =>
    Promise.resolve({
      totalSleep: 28800,
      deepSleep: 7200,
      lightSleep: 16200,
      remSleep: 5400,
      score: 85,
    })
  ),
}));

// Import tools after mocking
await import("./instant-garmin");

describe("Instant Garmin Tools", () => {
  test("get_current_vitals tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_current_vitals");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("real-time");
  });

  test("get_latest_activities tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_latest_activities");
    expect(tool).toBeDefined();
  });

  test("get_todays_sleep_instant tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_todays_sleep_instant");
    expect(tool).toBeDefined();
  });

  test("get_current_vitals executes correctly", async () => {
    const result = await toolRegistry.execute({
      name: "get_current_vitals",
      args: {},
    });
    expect(result.result).toEqual({
      steps: 10000,
      restingHr: 58,
      stressLevel: 30,
      bodyBatteryHigh: 85,
      bodyBatteryLow: 40,
    });
  });

  test("get_latest_activities executes correctly", async () => {
    const result = await toolRegistry.execute({
      name: "get_latest_activities",
      args: { limit: 5 },
    });
    expect(result.result).toBeArray();
    const activities = result.result as any[];
    expect(activities.length).toBeGreaterThan(0);
    expect(activities[0].activityName).toBe("Morning Run");
  });

  test("get_todays_sleep_instant executes correctly", async () => {
    const result = await toolRegistry.execute({
      name: "get_todays_sleep_instant",
      args: {},
    });
    const sleep = result.result as any;
    expect(sleep.totalSleepMinutes).toBe(480); // 28800 / 60
    expect(sleep.deepSleepMinutes).toBe(120); // 7200 / 60
    expect(sleep.score).toBe(85);
  });
});
