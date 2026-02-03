import { Database } from "bun:sqlite";
import { join } from "path";
import { existsSync } from "fs";
import { config } from "../config";
import type {
  DailySummary,
  Activity,
  SleepSession,
  WeightEntry,
  BodyBatteryEntry,
} from "../types";

function openDb(name: string): Database | null {
  const path = join(config.garminDbPath, name);
  if (!existsSync(path)) {
    return null;
  }
  return new Database(path, { readonly: true });
}

export function getTodaysSummary(): DailySummary | null {
  const db = openDb("garmin_summary.db");
  if (!db) return null;
  try {
    const today = new Date().toISOString().split("T")[0];
    const row = db
      .query<DailySummary, [string]>(
        `SELECT date, steps, floors, hr_min, hr_max, rhr, stress_avg,
                bb_max, bb_min, sleep_score
         FROM days_summary
         WHERE date = ?`
      )
      .get(today);
    return row || null;
  } finally {
    db.close();
  }
}

export function getRecentActivities(days: number = 7): Activity[] {
  const db = openDb("garmin_activities.db");
  if (!db) return [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<Activity, [string]>(
        `SELECT activity_id, name, type, start_time, elapsed_time,
                distance, avg_hr, max_hr, avg_speed, calories
         FROM activities
         WHERE date(start_time) >= ?
         ORDER BY start_time DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function getActivityDetails(activityId: string): Activity | null {
  const db = openDb("garmin_activities.db");
  if (!db) return null;
  try {
    return db
      .query<Activity, [string]>(
        `SELECT activity_id, name, type, start_time, elapsed_time,
                distance, avg_hr, max_hr, avg_speed, calories
         FROM activities
         WHERE activity_id = ?`
      )
      .get(activityId);
  } finally {
    db.close();
  }
}

export function getSleepTrend(days: number = 7): SleepSession[] {
  const db = openDb("garmin.db");
  if (!db) return [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<SleepSession, [string]>(
        `SELECT date, start_time, end_time, total_sleep,
                deep_sleep, light_sleep, rem_sleep, awake, score
         FROM sleep
         WHERE date >= ?
         ORDER BY date DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function getWeightTrend(days: number = 30): WeightEntry[] {
  const db = openDb("garmin.db");
  if (!db) return [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<WeightEntry, [string]>(
        `SELECT date, weight
         FROM weight
         WHERE date >= ?
         ORDER BY date DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function getBodyBatteryTrend(days: number = 7): BodyBatteryEntry[] {
  const db = openDb("garmin_summary.db");
  if (!db) return [];
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<BodyBatteryEntry, [string]>(
        `SELECT date, bb_max, bb_min
         FROM days_summary
         WHERE date >= ? AND bb_max IS NOT NULL
         ORDER BY date DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function queryGarmin(sql: string, dbName: string = "garmin.db"): unknown[] {
  const db = openDb(dbName);
  if (!db) return [];
  try {
    return db.query(sql).all();
  } finally {
    db.close();
  }
}
