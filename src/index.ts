import "./tools";
import { syncGarminBackground, isBackgroundSyncRunning } from "./garmin/sync";
import { initInstantClient } from "./garmin/instant";
import { startSyncScheduler, stopSyncScheduler } from "./garmin/scheduler";
import { startSummaryScheduler, stopSummaryScheduler } from "./summaries/scheduler";
import { runBackfill } from "./summaries/backfill";
import { startBot } from "./telegram";
import { hasTokens } from "./adapters/withings";

console.log("[Startup] Kettl starting...");

// Graceful shutdown handlers
let backfillCheckInterval: ReturnType<typeof setInterval> | null = null;

function shutdown(): void {
  console.log("[Startup] Shutting down...");
  stopSyncScheduler();
  stopSummaryScheduler();
  if (backfillCheckInterval) {
    clearInterval(backfillCheckInterval);
    backfillCheckInterval = null;
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function startup(): Promise<void> {
  // 1. Start initial GarminDB sync (if needed)
  syncGarminBackground();

  // 2. Check Withings configuration
  if (await hasTokens()) {
    console.log("[Startup] Withings body composition configured");
  } else {
    console.log("[Startup] Withings not configured. Run: bun run withings:setup");
  }

  // 3. Initialize Garmin Connect API client
  try {
    await initInstantClient();
    console.log("[Startup] Instant Garmin client ready");
  } catch (error) {
    console.error("[Startup] Failed to init instant client:", error);
  }

  // 4. Run backfill for missing daily summaries (in background)
  runBackfillAfterSync();

  // 5. Start 4-hour sync scheduler
  startSyncScheduler();

  // 6. Start EOD summary scheduler
  startSummaryScheduler();

  // 7. Start Telegram bot
  await startBot();
}

const MAX_BACKFILL_WAIT_MS = 2 * 60 * 60 * 1000; // 2 hours max wait

async function runBackfillAfterSync(): Promise<void> {
  const startWait = Date.now();

  // Wait for background sync to complete before backfilling
  backfillCheckInterval = setInterval(async () => {
    // Timeout after max wait
    if (Date.now() - startWait > MAX_BACKFILL_WAIT_MS) {
      console.error("[Startup] Backfill wait timed out after 2 hours");
      if (backfillCheckInterval) {
        clearInterval(backfillCheckInterval);
        backfillCheckInterval = null;
      }
      return;
    }

    if (!isBackgroundSyncRunning()) {
      if (backfillCheckInterval) {
        clearInterval(backfillCheckInterval);
        backfillCheckInterval = null;
      }

      // Calculate date range
      const startDateStr = process.env.GARMIN_START_DATE;
      if (!startDateStr) {
        console.log("[Startup] No GARMIN_START_DATE set, skipping backfill");
        return;
      }

      const startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) {
        console.error("[Startup] Invalid GARMIN_START_DATE:", startDateStr);
        return;
      }

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      console.log(
        `[Startup] Running backfill from ${startDateStr} to ${yesterday.toISOString().split("T")[0]}`
      );

      try {
        await runBackfill(startDate, yesterday);
      } catch (error) {
        console.error("[Startup] Backfill failed:", error);
      }
    }
  }, 5000); // Check every 5 seconds
}

startup().catch((error) => {
  console.error("[Startup] Failed:", error);
  process.exit(1);
});
