import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set up test directory before mocking
const testDir = await mkdtemp(join(tmpdir(), "garmin-queries-test-"));

// Mock config to use test directory
mock.module("../config", () => ({
  config: {
    garminDbPath: testDir,
  },
}));

// Import after mocking
import {
  getRecentActivities,
  getActivityDetails,
  getSleepTrend,
  getWeightTrend,
  getBodyBatteryTrend,
  queryGarmin,
  getSummaryForDate,
  getActivitiesForDate,
  getSleepForDate,
} from "./queries";

// Create test databases with schema
function createSummaryDb(): Database {
  const db = new Database(join(testDir, "garmin_summary.db"));
  db.run(`
    CREATE TABLE IF NOT EXISTS days_summary (
      day TEXT PRIMARY KEY,
      steps INTEGER,
      floors INTEGER,
      hr_min INTEGER,
      hr_max INTEGER,
      rhr_avg REAL,
      stress_avg REAL,
      bb_max INTEGER,
      bb_min INTEGER,
      sleep_avg REAL
    )
  `);
  return db;
}

function createActivitiesDb(): Database {
  const db = new Database(join(testDir, "garmin_activities.db"));
  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      activity_id TEXT PRIMARY KEY,
      name TEXT,
      sport TEXT,
      start_time TEXT,
      elapsed_time TEXT,
      distance REAL,
      avg_hr INTEGER,
      max_hr INTEGER,
      avg_speed REAL,
      calories INTEGER
    )
  `);
  return db;
}

function createGarminDb(): Database {
  const db = new Database(join(testDir, "garmin.db"));
  db.run(`
    CREATE TABLE IF NOT EXISTS sleep (
      day TEXT PRIMARY KEY,
      start TEXT,
      end TEXT,
      total_sleep TEXT,
      deep_sleep TEXT,
      light_sleep TEXT,
      rem_sleep TEXT,
      awake TEXT,
      score INTEGER
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS weight (
      day TEXT PRIMARY KEY,
      weight REAL
    )
  `);
  return db;
}

afterEach(async () => {
  // Clean up test databases
  try {
    await rm(join(testDir, "garmin_summary.db"), { force: true });
    await rm(join(testDir, "garmin_activities.db"), { force: true });
    await rm(join(testDir, "garmin.db"), { force: true });
  } catch {
    // ignore
  }
});

describe("getRecentActivities", () => {
  test("returns empty array when database doesn't exist", () => {
    const result = getRecentActivities();
    expect(result).toEqual([]);
  });

  test("returns activities from last N days", () => {
    const db = createActivitiesDb();
    const today = new Date().toISOString().split("T")[0];
    db.run(
      `INSERT INTO activities (activity_id, name, sport, start_time, distance)
       VALUES (?, ?, ?, ?, ?)`,
      ["act-1", "Morning Run", "running", `${today} 08:00:00.000000`, 5.2]
    );
    db.close();

    const result = getRecentActivities(7);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Morning Run");
    expect(result[0].type).toBe("running"); // sport aliased as type
  });

  test("filters by date cutoff", () => {
    const db = createActivitiesDb();
    const today = new Date().toISOString().split("T")[0];
    const oldDate = "2020-01-01";

    db.run(
      `INSERT INTO activities (activity_id, name, sport, start_time)
       VALUES (?, ?, ?, ?)`,
      ["act-1", "Recent", "running", `${today} 08:00:00.000000`]
    );
    db.run(
      `INSERT INTO activities (activity_id, name, sport, start_time)
       VALUES (?, ?, ?, ?)`,
      ["act-2", "Old", "running", `${oldDate} 08:00:00.000000`]
    );
    db.close();

    const result = getRecentActivities(7);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Recent");
  });
});

describe("getActivityDetails", () => {
  test("returns null when database doesn't exist", () => {
    const result = getActivityDetails("123");
    expect(result).toBeNull();
  });

  test("returns activity by id", () => {
    const db = createActivitiesDb();
    db.run(
      `INSERT INTO activities (activity_id, name, sport, distance, avg_hr)
       VALUES (?, ?, ?, ?, ?)`,
      ["act-123", "Evening Run", "running", 10.5, 145]
    );
    db.close();

    const result = getActivityDetails("act-123");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Evening Run");
    expect(result!.type).toBe("running"); // sport aliased as type
    expect(result!.avg_hr).toBe(145);
  });

  test("returns null for unknown id", () => {
    const db = createActivitiesDb();
    db.close();

    const result = getActivityDetails("nonexistent");
    expect(result).toBeNull();
  });
});

describe("getSleepTrend", () => {
  test("returns empty array when database doesn't exist", () => {
    const result = getSleepTrend();
    expect(result).toEqual([]);
  });

  test("returns sleep data for last N days", () => {
    const db = createGarminDb();
    const today = new Date().toISOString().split("T")[0];
    db.run(
      `INSERT INTO sleep (day, total_sleep, deep_sleep, score)
       VALUES (?, ?, ?, ?)`,
      [today, "07:30:00.000000", "01:45:00.000000", 85]
    );
    db.close();

    const result = getSleepTrend(7);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(85);
  });
});

describe("getWeightTrend", () => {
  test("returns empty array when database doesn't exist", () => {
    const result = getWeightTrend();
    expect(result).toEqual([]);
  });

  test("returns weight entries", () => {
    const db = createGarminDb();
    const today = new Date().toISOString().split("T")[0];
    db.run(`INSERT INTO weight (day, weight) VALUES (?, ?)`, [today, 75.5]);
    db.close();

    const result = getWeightTrend(30);
    expect(result).toHaveLength(1);
    expect(result[0].weight).toBe(75.5);
  });
});

describe("getBodyBatteryTrend", () => {
  test("returns empty array when database doesn't exist", () => {
    const result = getBodyBatteryTrend();
    expect(result).toEqual([]);
  });

  test("returns body battery data", () => {
    const db = createSummaryDb();
    const today = new Date().toISOString().split("T")[0];
    db.run(
      `INSERT INTO days_summary (day, bb_max, bb_min) VALUES (?, ?, ?)`,
      [today, 90, 25]
    );
    db.close();

    const result = getBodyBatteryTrend(7);
    expect(result).toHaveLength(1);
    expect(result[0].bb_max).toBe(90);
    expect(result[0].bb_min).toBe(25);
  });
});

describe("queryGarmin", () => {
  test("returns empty array when database doesn't exist", () => {
    const result = queryGarmin("SELECT * FROM nonexistent");
    expect(result).toEqual([]);
  });

  test("executes arbitrary SQL", () => {
    const db = createGarminDb();
    db.run(`INSERT INTO weight (day, weight) VALUES (?, ?)`, ["2026-02-03", 76]);
    db.close();

    const result = queryGarmin("SELECT day, weight FROM weight");
    expect(result).toHaveLength(1);
    expect((result[0] as any).weight).toBe(76);
  });

  test("uses specified database", () => {
    const db = createSummaryDb();
    db.run(`INSERT INTO days_summary (day, steps) VALUES (?, ?)`, ["2026-02-03", 5000]);
    db.close();

    const result = queryGarmin("SELECT steps FROM days_summary", "garmin_summary.db");
    expect(result).toHaveLength(1);
    expect((result[0] as any).steps).toBe(5000);
  });
});

describe("getSummaryForDate", () => {
  test("returns null when database doesn't exist", () => {
    const result = getSummaryForDate("2026-02-03");
    expect(result).toBeNull();
  });

  test("returns summary for specific date with sleep_score", () => {
    const db = createSummaryDb();
    db.run(
      `INSERT INTO days_summary (day, steps, rhr_avg, bb_max, bb_min, sleep_avg)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["2026-02-03", 12000, 58, 80, 30, 78]
    );
    db.close();

    const result = getSummaryForDate("2026-02-03");
    expect(result).not.toBeNull();
    expect(result!.steps).toBe(12000);
    expect(result!.sleep_score).toBe(78); // Verify fix: sleep_score is now included
  });
});

describe("getActivitiesForDate", () => {
  test("returns empty array when database doesn't exist", () => {
    const result = getActivitiesForDate("2026-02-03");
    expect(result).toEqual([]);
  });

  test("returns activities for specific date using sport column", () => {
    const db = createActivitiesDb();
    db.run(
      `INSERT INTO activities (activity_id, name, sport, start_time, distance)
       VALUES (?, ?, ?, ?, ?)`,
      ["act-1", "Long Run", "running", "2026-02-03 07:00:00.000000", 15.0]
    );
    db.close();

    const result = getActivitiesForDate("2026-02-03");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("running"); // Verify: sport aliased as type
    expect(result[0].distance).toBe(15.0);
  });
});

describe("getSleepForDate", () => {
  test("returns null when database doesn't exist", () => {
    const result = getSleepForDate("2026-02-03");
    expect(result).toBeNull();
  });

  test("returns sleep data for specific date", () => {
    const db = createGarminDb();
    db.run(
      `INSERT INTO sleep (day, total_sleep, score) VALUES (?, ?, ?)`,
      ["2026-02-03", "08:00:00.000000", 90]
    );
    db.close();

    const result = getSleepForDate("2026-02-03");
    expect(result).not.toBeNull();
    expect(result!.score).toBe(90);
  });
});
