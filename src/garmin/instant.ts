import { GarminConnect } from "garmin-connect";
import { config } from "../config";

let client: GarminConnect | null = null;
let initialized = false;

export interface InstantVitals {
  steps: number;
  restingHr: number | null;
  stressLevel: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
}

export interface InstantActivity {
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeLocal: string;
  distance?: number;
  duration?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
}

export interface InstantSleep {
  totalSleep: number;
  deepSleep: number;
  lightSleep: number;
  remSleep: number;
  score: number | null;
}

export async function initInstantClient(): Promise<void> {
  if (initialized && client) {
    return;
  }

  const credentials = {
    username: config.garminEmail(),
    password: config.garminPassword(),
  };
  client = new GarminConnect(credentials);
  await client.login();
  initialized = true;
  console.log("[Instant] Garmin Connect client initialized");
}

export async function getCurrentVitals(): Promise<InstantVitals> {
  if (!client) {
    await initInstantClient();
  }
  if (!client) {
    throw new Error("Failed to initialize Garmin client");
  }

  const today = new Date();

  try {
    // Get steps
    const steps = await client.getSteps(today);

    // Get resting HR and body battery from sleep data
    let restingHr: number | null = null;
    let bodyBatteryHigh: number | null = null;
    let bodyBatteryLow: number | null = null;

    try {
      const sleepData = await client.getSleepData(today);
      restingHr = sleepData?.restingHeartRate ?? null;

      // Extract body battery high/low from sleep data if available
      if (sleepData?.sleepBodyBattery?.length) {
        const values = sleepData.sleepBodyBattery.map((b) => b.value);
        bodyBatteryHigh = Math.max(...values);
        bodyBatteryLow = Math.min(...values);
      }
    } catch {
      // Sleep data not available, continue without it
    }

    return {
      steps: steps ?? 0,
      restingHr,
      stressLevel: null, // Not easily available from current API
      bodyBatteryHigh,
      bodyBatteryLow,
    };
  } catch (error) {
    console.error(`[Instant] Failed to get vitals for ${today.toISOString().split("T")[0]}:`, error);
    throw error;
  }
}

export async function getLatestActivities(
  limit: number = 10
): Promise<InstantActivity[]> {
  if (!client) {
    await initInstantClient();
  }
  if (!client) {
    throw new Error("Failed to initialize Garmin client");
  }

  try {
    const activities = await client.getActivities(0, limit);

    return activities.map((a: any) => ({
      activityId: a.activityId,
      activityName: a.activityName,
      activityType: a.activityType?.typeKey ?? "unknown",
      startTimeLocal: a.startTimeLocal,
      distance: a.distance,
      duration: a.duration,
      averageHR: a.averageHR,
      maxHR: a.maxHR,
      calories: a.calories,
    }));
  } catch (error) {
    console.error(`[Instant] Failed to get activities (limit: ${limit}):`, error);
    throw error;
  }
}

export async function getTodaysSleep(): Promise<InstantSleep | null> {
  if (!client) {
    await initInstantClient();
  }
  if (!client) {
    throw new Error("Failed to initialize Garmin client");
  }

  const today = new Date();

  try {
    const sleep = await client.getSleepData(today);
    const dto = sleep?.dailySleepDTO;

    if (!dto) {
      return null;
    }

    return {
      totalSleep: dto.sleepTimeSeconds ?? 0,
      deepSleep: dto.deepSleepSeconds ?? 0,
      lightSleep: dto.lightSleepSeconds ?? 0,
      remSleep: dto.remSleepSeconds ?? 0,
      score: dto.sleepScores?.overall?.value ?? null,
    };
  } catch (error) {
    console.error(`[Instant] Failed to get sleep data for ${today.toISOString().split("T")[0]}:`, error);
    return null;
  }
}

export function isInstantClientInitialized(): boolean {
  return initialized;
}
