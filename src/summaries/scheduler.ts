import { config } from "../config";
import { syncGarmin } from "../garmin/sync";
import { generateDailySummary } from "./generator";

let summaryTimeout: ReturnType<typeof setTimeout> | null = null;

function getHourInTimezone(date: Date, tz: string): number {
  return parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }),
    10
  );
}

function getMinuteInTimezone(date: Date, tz: string): number {
  return parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      minute: "2-digit",
    }),
    10
  );
}

export function getMillisecondsToNextSummary(now: Date = new Date()): number {
  const currentHour = getHourInTimezone(now, config.timezone);
  const currentMinute = getMinuteInTimezone(now, config.timezone);

  let hoursUntilSummary: number;
  if (currentHour >= config.summaryHour) {
    // Summary hour has passed today, schedule for tomorrow
    hoursUntilSummary = 24 - currentHour + config.summaryHour;
  } else {
    // Summary hour is later today
    hoursUntilSummary = config.summaryHour - currentHour;
  }

  // Convert to milliseconds, accounting for current minute
  const minutesUntilSummary = hoursUntilSummary * 60 - currentMinute;
  return minutesUntilSummary * 60 * 1000;
}

function getYesterdayDateStr(): string {
  // Get "yesterday" in the configured timezone, not UTC
  const now = new Date();
  const todayInTz = now.toLocaleDateString("en-CA", { timeZone: config.timezone }); // YYYY-MM-DD format
  const todayDate = new Date(todayInTz + "T00:00:00");
  todayDate.setDate(todayDate.getDate() - 1);
  return todayDate.toISOString().split("T")[0];
}

export async function runEodSummary(): Promise<void> {
  console.log("[EOD] Starting end-of-day summary generation");

  // Force sync before generating summary
  console.log("[EOD] Running forced Garmin sync");
  try {
    await syncGarmin();
    console.log("[EOD] Garmin sync completed");
  } catch (error) {
    console.error("[EOD] Garmin sync failed, continuing with summary:", error);
  }

  // Generate summary for yesterday
  const yesterdayStr = getYesterdayDateStr();
  console.log(`[EOD] Generating summary for ${yesterdayStr}`);

  try {
    await generateDailySummary(yesterdayStr, { overwrite: true });
    console.log(`[EOD] Summary generated for ${yesterdayStr}`);
  } catch (error) {
    console.error(`[EOD] Failed to generate summary:`, error);
  }

  // Schedule next run
  scheduleNextSummary();
}

function scheduleNextSummary(): void {
  const msToNext = getMillisecondsToNextSummary();
  const nextTime = new Date(Date.now() + msToNext);

  console.log(`[EOD] Next summary scheduled for ${nextTime.toISOString()}`);

  summaryTimeout = setTimeout(() => {
    runEodSummary();
  }, msToNext);
}

export function startSummaryScheduler(): void {
  if (summaryTimeout) {
    console.log("[EOD] Summary scheduler already running");
    return;
  }

  console.log(
    `[EOD] Starting summary scheduler (daily at ${config.summaryHour}:00 ${config.timezone})`
  );
  scheduleNextSummary();
}

export function stopSummaryScheduler(): void {
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
    console.log("[EOD] Summary scheduler stopped");
  }
}
