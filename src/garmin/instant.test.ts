import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock config
mock.module("../config", () => ({
  config: {
    garminEmail: () => "test@example.com",
    garminPassword: () => "testpassword",
  },
}));

// Mock garmin-connect before importing instant
const mockLogin = mock(() => Promise.resolve());
const mockGetSteps = mock(() => Promise.resolve(8000));
const mockGetActivities = mock(() =>
  Promise.resolve([
    { activityId: 123, activityName: "Morning Run", startTimeLocal: "2026-02-03" },
  ])
);
const mockGetSleepData = mock(() =>
  Promise.resolve({
    dailySleepDTO: {
      sleepTimeSeconds: 25200,
      deepSleepSeconds: 6300,
      lightSleepSeconds: 14400,
      remSleepSeconds: 4500,
      sleepScores: { overall: { value: 82 } },
    },
    restingHeartRate: 55,
    sleepBodyBattery: [
      { value: 80, startGMT: 1000 },
      { value: 30, startGMT: 2000 },
    ],
  })
);

mock.module("garmin-connect", () => ({
  GarminConnect: class {
    login = mockLogin;
    getSteps = mockGetSteps;
    getActivities = mockGetActivities;
    getSleepData = mockGetSleepData;
  },
}));

const { initInstantClient, getCurrentVitals, getLatestActivities, getTodaysSleep } = await import(
  "./instant"
);

describe("Instant Garmin Client", () => {
  beforeEach(() => {
    mockLogin.mockClear();
    mockGetSteps.mockClear();
    mockGetActivities.mockClear();
    mockGetSleepData.mockClear();
  });

  test("initInstantClient authenticates on first call", async () => {
    await initInstantClient();
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  test("getCurrentVitals returns formatted vitals", async () => {
    const vitals = await getCurrentVitals();
    expect(vitals).toEqual({
      steps: 8000,
      restingHr: 55,
      stressLevel: null, // Not available from current API
      bodyBatteryHigh: 80,
      bodyBatteryLow: 30,
    });
  });

  test("getLatestActivities returns activities since date", async () => {
    const activities = await getLatestActivities(5);
    expect(mockGetActivities).toHaveBeenCalledWith(0, 5);
    expect(activities).toHaveLength(1);
    expect(activities[0].activityId).toBe(123);
  });

  test("getTodaysSleep returns formatted sleep data", async () => {
    const sleep = await getTodaysSleep();
    expect(sleep?.totalSleep).toBe(25200);
    expect(sleep?.score).toBe(82);
  });
});
