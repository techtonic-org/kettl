import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock garmin module
const mockSyncGarmin = mock(() => Promise.resolve({ success: true, durationMs: 1500 }));
const mockGetTodaysSummary = mock(() => ({
  date: "2026-02-03",
  steps: 8000,
  rhr: 55,
  stress_avg: 30,
  bb_max: 85,
  bb_min: 35,
}));
const mockGetRecentActivities = mock(() => [
  { activity_id: "123", name: "Morning Run", type: "running" },
]);
const mockGetActivityDetails = mock(() => ({
  activity_id: "123",
  name: "Morning Run",
  type: "running",
}));
const mockGetSleepTrend = mock(() => [{ date: "2026-02-03", score: 82 }]);
const mockGetWeightTrend = mock(() => [{ date: "2026-02-03", weight: 75 }]);
const mockGetBodyBatteryTrend = mock(() => [{ date: "2026-02-03", bb_max: 85 }]);
const mockQueryGarmin = mock(() => [{ day: "2026-02-03" }]);

mock.module("../garmin", () => ({
  syncGarmin: mockSyncGarmin,
  getTodaysSummary: mockGetTodaysSummary,
  getRecentActivities: mockGetRecentActivities,
  getActivityDetails: mockGetActivityDetails,
  getSleepTrend: mockGetSleepTrend,
  getWeightTrend: mockGetWeightTrend,
  getBodyBatteryTrend: mockGetBodyBatteryTrend,
  queryGarmin: mockQueryGarmin,
}));

// Create a test registry
class TestToolRegistry {
  private tools: Map<string, { definition: any; handler: any }> = new Map();

  register(definition: any, handler: any): void {
    this.tools.set(definition.name, { definition, handler });
  }

  async execute(name: string, args: any = {}): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.handler(args);
  }

  getDefinition(name: string): any {
    return this.tools.get(name)?.definition;
  }
}

const registry = new TestToolRegistry();

// Register all tools (mirroring garmin.ts)
registry.register(
  { name: "sync_garmin", description: "Sync garmin", parameters: {} },
  async () => {
    const result = await mockSyncGarmin();
    if (result.success) {
      return { synced: true, durationMs: result.durationMs };
    } else {
      return { synced: false, error: result.error };
    }
  }
);

registry.register(
  { name: "get_todays_summary", description: "Today's summary", parameters: {} },
  async () => mockGetTodaysSummary()
);

registry.register(
  { name: "get_recent_activities", description: "Recent activities", parameters: {} },
  async (args: any) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return mockGetRecentActivities(days);
  }
);

registry.register(
  { name: "get_activity_details", description: "Activity details", parameters: {} },
  async (args: any) => {
    const id = String(args.activity_id);
    return mockGetActivityDetails(id);
  }
);

registry.register(
  { name: "get_sleep_trend", description: "Sleep trend", parameters: {} },
  async (args: any) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return mockGetSleepTrend(days);
  }
);

registry.register(
  { name: "get_weight_trend", description: "Weight trend", parameters: {} },
  async (args: any) => {
    const days = typeof args.days === "number" ? args.days : 30;
    return mockGetWeightTrend(days);
  }
);

registry.register(
  { name: "get_body_battery_trend", description: "Body battery trend", parameters: {} },
  async (args: any) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return mockGetBodyBatteryTrend(days);
  }
);

registry.register(
  { name: "query_garmin", description: "Raw SQL query", parameters: {} },
  async (args: any) => {
    const sql = String(args.sql);
    const dbName = typeof args.db_name === "string" ? args.db_name : "garmin.db";
    return mockQueryGarmin(sql, dbName);
  }
);

beforeEach(() => {
  mockSyncGarmin.mockClear();
  mockGetTodaysSummary.mockClear();
  mockGetRecentActivities.mockClear();
  mockGetActivityDetails.mockClear();
  mockGetSleepTrend.mockClear();
  mockGetWeightTrend.mockClear();
  mockGetBodyBatteryTrend.mockClear();
  mockQueryGarmin.mockClear();
});

describe("sync_garmin tool", () => {
  test("returns success result", async () => {
    const result = await registry.execute("sync_garmin");
    expect(result).toEqual({ synced: true, durationMs: 1500 });
  });

  test("returns error on failure", async () => {
    mockSyncGarmin.mockImplementation(() =>
      Promise.resolve({ success: false, durationMs: 500, error: "Connection failed" })
    );
    const result = await registry.execute("sync_garmin");
    expect(result).toEqual({ synced: false, error: "Connection failed" });
  });
});

describe("get_todays_summary tool", () => {
  test("returns today's summary", async () => {
    const result = await registry.execute("get_todays_summary");
    expect(result.steps).toBe(8000);
    expect(result.rhr).toBe(55);
  });
});

describe("get_recent_activities tool", () => {
  test("uses default 7 days", async () => {
    await registry.execute("get_recent_activities", {});
    expect(mockGetRecentActivities).toHaveBeenCalledWith(7);
  });

  test("accepts custom days parameter", async () => {
    await registry.execute("get_recent_activities", { days: 14 });
    expect(mockGetRecentActivities).toHaveBeenCalledWith(14);
  });

  test("ignores non-number days", async () => {
    await registry.execute("get_recent_activities", { days: "invalid" });
    expect(mockGetRecentActivities).toHaveBeenCalledWith(7);
  });
});

describe("get_activity_details tool", () => {
  test("passes activity_id as string", async () => {
    await registry.execute("get_activity_details", { activity_id: "12345" });
    expect(mockGetActivityDetails).toHaveBeenCalledWith("12345");
  });

  test("converts numeric id to string", async () => {
    await registry.execute("get_activity_details", { activity_id: 12345 });
    expect(mockGetActivityDetails).toHaveBeenCalledWith("12345");
  });
});

describe("get_sleep_trend tool", () => {
  test("uses default 7 days", async () => {
    await registry.execute("get_sleep_trend", {});
    expect(mockGetSleepTrend).toHaveBeenCalledWith(7);
  });

  test("accepts custom days", async () => {
    await registry.execute("get_sleep_trend", { days: 30 });
    expect(mockGetSleepTrend).toHaveBeenCalledWith(30);
  });
});

describe("get_weight_trend tool", () => {
  test("uses default 30 days", async () => {
    await registry.execute("get_weight_trend", {});
    expect(mockGetWeightTrend).toHaveBeenCalledWith(30);
  });

  test("accepts custom days", async () => {
    await registry.execute("get_weight_trend", { days: 90 });
    expect(mockGetWeightTrend).toHaveBeenCalledWith(90);
  });
});

describe("get_body_battery_trend tool", () => {
  test("uses default 7 days", async () => {
    await registry.execute("get_body_battery_trend", {});
    expect(mockGetBodyBatteryTrend).toHaveBeenCalledWith(7);
  });
});

describe("query_garmin tool", () => {
  test("passes sql and default db", async () => {
    await registry.execute("query_garmin", { sql: "SELECT * FROM sleep" });
    expect(mockQueryGarmin).toHaveBeenCalledWith("SELECT * FROM sleep", "garmin.db");
  });

  test("uses custom db_name", async () => {
    await registry.execute("query_garmin", {
      sql: "SELECT * FROM activities",
      db_name: "garmin_activities.db",
    });
    expect(mockQueryGarmin).toHaveBeenCalledWith(
      "SELECT * FROM activities",
      "garmin_activities.db"
    );
  });
});
