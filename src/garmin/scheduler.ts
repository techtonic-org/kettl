import { config } from "../config";
import { syncGarmin } from "./sync";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastScheduledSyncTime: Date | null = null;

export function getHourInTimezone(date: Date, tz: string): number {
  return parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }),
    10
  );
}

export function getMinutesToEod(date: Date, summaryHour: number, tz: string): number {
  const currentHour = getHourInTimezone(date, tz);
  const currentMinute = parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      minute: "2-digit",
    }),
    10
  );

  let hoursToEod: number;
  if (currentHour >= summaryHour) {
    // EOD is tomorrow
    hoursToEod = 24 - currentHour + summaryHour;
  } else {
    // EOD is today
    hoursToEod = summaryHour - currentHour;
  }

  return hoursToEod * 60 - currentMinute;
}

export function shouldSkipScheduledSync(now: Date = new Date()): boolean {
  const minutesToEod = getMinutesToEod(now, config.summaryHour, config.timezone);
  // Skip if EOD is within 60 minutes
  return minutesToEod <= 60;
}

export function getNextSyncTime(now: Date = new Date()): Date {
  const intervalMs = config.garminSyncIntervalHours * 60 * 60 * 1000;
  return new Date(now.getTime() + intervalMs);
}

export async function runScheduledSync(now: Date = new Date()): Promise<void> {
  if (shouldSkipScheduledSync(now)) {
    console.log(
      "[Scheduler] Skipping scheduled sync - EOD summary within 1 hour"
    );
    return;
  }

  console.log("[Scheduler] Running scheduled Garmin sync");
  try {
    await syncGarmin();
    lastScheduledSyncTime = new Date();
    console.log("[Scheduler] Scheduled sync completed");
  } catch (error) {
    console.error("[Scheduler] Scheduled sync failed:", error);
  }
}

export function startSyncScheduler(): void {
  if (schedulerInterval) {
    console.log("[Scheduler] Sync scheduler already running");
    return;
  }

  const intervalMs = config.garminSyncIntervalHours * 60 * 60 * 1000;

  console.log(
    `[Scheduler] Starting sync scheduler (every ${config.garminSyncIntervalHours} hours)`
  );

  schedulerInterval = setInterval(() => {
    runScheduledSync();
  }, intervalMs);

  // Log next scheduled sync time
  const nextSync = getNextSyncTime();
  console.log(`[Scheduler] Next scheduled sync at ${nextSync.toISOString()}`);
}

export function stopSyncScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Sync scheduler stopped");
  }
}

export function getLastScheduledSyncTime(): Date | null {
  return lastScheduledSyncTime;
}
