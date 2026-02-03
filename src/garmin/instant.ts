import { GarminConnect } from "garmin-connect";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { config } from "../config";

let client: GarminConnect | null = null;
let initialized = false;
let lastAuthFailure: Date | null = null;
let cachedDisplayName: string | null = null;
const AUTH_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes cooldown after auth failure

const TOKEN_DIR = join(homedir(), ".garmin-tokens");

// Real-time daily summary endpoint (not the stale stats endpoint)
const GC_API = "https://connectapi.garmin.com";
const DAILY_SUMMARY_URL = `${GC_API}/usersummary-service/usersummary/daily`;

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

function isInAuthCooldown(): boolean {
  if (!lastAuthFailure) return false;
  const elapsed = Date.now() - lastAuthFailure.getTime();
  return elapsed < AUTH_COOLDOWN_MS;
}

async function doLogin(): Promise<void> {
  if (!client) {
    throw new Error("Client not initialized");
  }

  // Check cooldown before attempting login
  if (isInAuthCooldown()) {
    const remainingMins = Math.ceil((AUTH_COOLDOWN_MS - (Date.now() - lastAuthFailure!.getTime())) / 60000);
    throw new Error(`Garmin auth in cooldown, retry in ${remainingMins} minutes`);
  }

  try {
    await client.login();
    client.exportTokenToFile(TOKEN_DIR);
    lastAuthFailure = null;
    console.log("[Instant] Garmin Connect logged in and tokens saved");
  } catch (loginError) {
    lastAuthFailure = new Date();
    console.error("[Instant] Login failed, cooldown started:", loginError);
    throw loginError;
  }
}

export async function initInstantClient(): Promise<void> {
  if (initialized && client) {
    return;
  }

  // Check cooldown before attempting init
  if (isInAuthCooldown()) {
    const remainingMins = Math.ceil((AUTH_COOLDOWN_MS - (Date.now() - lastAuthFailure!.getTime())) / 60000);
    throw new Error(`Garmin auth in cooldown, retry in ${remainingMins} minutes`);
  }

  const credentials = {
    username: config.garminEmail(),
    password: config.garminPassword(),
  };
  client = new GarminConnect(credentials);

  // Ensure token directory exists
  if (!existsSync(TOKEN_DIR)) {
    mkdirSync(TOKEN_DIR, { recursive: true });
  }

  // Try to load existing tokens first
  try {
    client.loadTokenByFile(TOKEN_DIR);
    // Verify tokens work by making a simple request
    await client.getSteps(new Date());
    console.log("[Instant] Garmin Connect client initialized from saved tokens");
  } catch (tokenError) {
    // Tokens invalid or missing, need fresh login
    console.log("[Instant] Saved tokens invalid or missing, logging in fresh...");
    await doLogin();
  }

  initialized = true;
}

function is403Error(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("(403)") || error.message.includes("Forbidden");
  }
  return false;
}

async function withReauth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (is403Error(error) && client && !isInAuthCooldown()) {
      console.log("[Instant] Got 403, attempting re-authentication...");
      try {
        await doLogin();
        // Retry the operation
        return await fn();
      } catch (reAuthError) {
        console.error("[Instant] Re-authentication failed:", reAuthError);
        throw error; // Throw original error
      }
    }
    throw error;
  }
}

async function getDisplayName(): Promise<string> {
  if (cachedDisplayName) {
    return cachedDisplayName;
  }
  const profile = await client!.getUserProfile();
  cachedDisplayName = (profile as any).displayName;
  if (!cachedDisplayName) {
    throw new Error("Could not get display name from profile");
  }
  return cachedDisplayName;
}

interface DailySummary {
  totalSteps?: number;
  restingHeartRate?: number;
  currentDayRestingHeartRate?: number;
  averageStressLevel?: number;
  maxStressLevel?: number;
  stressPercentage?: number;
  bodyBatteryChargedValue?: number;
  bodyBatteryDrainedValue?: number;
  bodyBatteryHighestValue?: number;
  bodyBatteryLowestValue?: number;
}

export async function getCurrentVitals(): Promise<InstantVitals> {
  if (!client) {
    await initInstantClient();
  }
  if (!client) {
    throw new Error("Failed to initialize Garmin client");
  }

  const today = new Date();
  const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD

  return withReauth(async () => {
    // Use real-time daily summary endpoint instead of stale stats endpoint
    const displayName = await getDisplayName();
    const summary = await client!.get<DailySummary>(
      `${DAILY_SUMMARY_URL}/${displayName}`,
      { params: { calendarDate: dateStr } }
    );

    return {
      steps: summary.totalSteps ?? 0,
      restingHr: summary.currentDayRestingHeartRate ?? summary.restingHeartRate ?? null,
      stressLevel: summary.averageStressLevel ?? null,
      bodyBatteryHigh: summary.bodyBatteryHighestValue ?? null,
      bodyBatteryLow: summary.bodyBatteryLowestValue ?? null,
    };
  }).catch((error) => {
    console.error(`[Instant] Failed to get vitals for ${dateStr}:`, error);
    throw error;
  });
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

  return withReauth(async () => {
    const activities = await client!.getActivities(0, limit);

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
  }).catch((error) => {
    console.error(`[Instant] Failed to get activities (limit: ${limit}):`, error);
    throw error;
  });
}

export async function getTodaysSleep(): Promise<InstantSleep | null> {
  if (!client) {
    await initInstantClient();
  }
  if (!client) {
    throw new Error("Failed to initialize Garmin client");
  }

  const today = new Date();

  return withReauth(async () => {
    const sleep = await client!.getSleepData(today);
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
  }).catch((error) => {
    console.error(`[Instant] Failed to get sleep data for ${today.toISOString().split("T")[0]}:`, error);
    return null;
  });
}

export function isInstantClientInitialized(): boolean {
  return initialized;
}
