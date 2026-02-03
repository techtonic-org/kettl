import { spawn } from "bun";
import { join } from "path";
import { homedir } from "os";
import { config } from "../config";

export interface SyncResult {
  success: boolean;
  durationMs: number;
  error?: string;
  firstSync?: boolean;
}

let backgroundSyncRunning = false;
let syncPhase: string = "Starting";
let syncPercent: string | null = null;
let syncStartTime: Date | null = null;

// Generate GarminConnectConfig.json from env vars if it doesn't exist
async function ensureGarminConfig(): Promise<void> {
  const configDir = join(homedir(), ".GarminDb");
  const configPath = join(configDir, "GarminConnectConfig.json");

  // Check if config already exists
  const file = Bun.file(configPath);
  if (await file.exists()) {
    return;
  }

  // Get credentials from env
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("GARMIN_EMAIL and GARMIN_PASSWORD must be set");
  }

  // Create config directory
  await Bun.spawn({ cmd: ["mkdir", "-p", configDir] }).exited;

  // Get optional start dates (default to 6 months ago)
  const defaultStartDate = new Date();
  defaultStartDate.setMonth(defaultStartDate.getMonth() - 6);
  const defaultDateStr = defaultStartDate.toISOString().split("T")[0];

  const startDate = process.env.GARMIN_START_DATE || defaultDateStr;
  const activityCount = parseInt(process.env.GARMIN_ACTIVITY_COUNT || "200", 10);
  const downloadDaysOverlap = parseInt(process.env.GARMIN_DOWNLOAD_OVERLAP || "3", 10);

  // Write config file - field names from garmin_connect_config_manager.py
  const garminConfig = {
    credentials: {
      user: email,
      password: password,
    },
    data: {
      weight_start_date: startDate,
      sleep_start_date: startDate,
      rhr_start_date: startDate,
      monitoring_start_date: startDate,
      download_days_overlap: downloadDaysOverlap,
      download_latest_activities: activityCount,
      download_all_activities: activityCount,
    },
    directories: {
      relative_to_home: true,
    },
    enabled_stats: {
      monitoring: true,
      sleep: true,
      rhr: true,
      weight: true,
      activities: true,
    },
    settings: {
      metric: true,
    },
  };

  await Bun.write(configPath, JSON.stringify(garminConfig, null, 2));
}

export async function syncGarmin(): Promise<SyncResult> {
  const start = Date.now();

  try {
    // Ensure config exists before syncing
    await ensureGarminConfig();

    // Just sync latest activities for fast incremental update
    const proc = spawn({
      cmd: ["garmindb_cli.py", "--activities", "--latest", "--download", "--import"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => {
      proc.kill();
    }, config.garminSyncTimeout);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    const durationMs = Date.now() - start;

    if (exitCode === 0) {
      return { success: true, durationMs };
    } else {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        durationMs,
        error: `Exit code ${exitCode}: ${stderr.slice(0, 200)}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Get timestamp of last sync (based on db modification time)
export function getLastSyncTime(): Date | null {
  try {
    const stat = Bun.spawnSync({
      cmd: ["stat", "-c", "%Y", `${config.garminDbPath}/garmin.db`],
    });
    const timestamp = parseInt(stat.stdout.toString().trim());
    return isNaN(timestamp) ? null : new Date(timestamp * 1000);
  } catch {
    return null;
  }
}

// Background sync for initial startup (no timeout, runs async)
export async function syncGarminBackground(): Promise<void> {
  if (backgroundSyncRunning) {
    console.log("Background sync already running, skipping");
    return;
  }

  backgroundSyncRunning = true;
  syncStartTime = new Date();
  syncPhase = "Starting";
  syncPercent = null;
  const start = Date.now();

  try {
    await ensureGarminConfig();

    // Skip sync entirely if databases already exist - user can trigger manual sync if needed
    const dbPath = join(homedir(), "HealthData/DBs/garmin.db");
    const dbExists = await Bun.file(dbPath).exists();

    if (dbExists) {
      console.log("[SYNC] Databases exist, skipping startup sync");
      backgroundSyncRunning = false;
      syncStartTime = null;
      return;
    }

    console.log("[SYNC] No databases found, running initial full sync");

    const proc = spawn({
      cmd: ["garmindb_cli.py", "--all", "--download", "--import", "--analyze"],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read stdout for progress updates
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/[\r\n]/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            // Parse progress line like "1%|          | 39/4052 [00:45<1:18:43,  1.18s/days]"
            const progressMatch = line.match(/(\d+)%\|.*\|\s*(\d+)\/(\d+)\s*\[([^\]]+)\]/);
            if (progressMatch) {
              const [, pct, current, total, time] = progressMatch;
              syncPercent = `${pct}% (${current}/${total}) - ${time}`;
            } else if (line.includes("___")) {
              // Section headers like "___Downloading All Data___"
              syncPhase = line.replace(/_/g, "").trim();
              syncPercent = null; // Reset percent for new phase
            }
            console.log(line);
          }
        }
      }
    })();

    // Also log stderr
    const stderrReader = proc.stderr.getReader();
    (async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        console.error(decoder.decode(value, { stream: true }));
      }
    })();

    const exitCode = await proc.exited;
    const durationMs = Date.now() - start;

    if (exitCode === 0) {
      console.log(`Background Garmin sync completed in ${Math.round(durationMs / 1000)}s`);
      syncPhase = "Completed";
    } else {
      console.error(`Background Garmin sync failed with exit code ${exitCode}`);
      syncPhase = "Failed";
    }
  } catch (error) {
    console.error("Background Garmin sync error:", error);
    syncPhase = "Error";
  } finally {
    backgroundSyncRunning = false;
    syncStartTime = null;
    syncPercent = null;
  }
}

export function isBackgroundSyncRunning(): boolean {
  return backgroundSyncRunning;
}

export function getSyncProgress(): { running: boolean; phase: string; percent: string | null; startedAt: Date | null } {
  return {
    running: backgroundSyncRunning,
    phase: syncPhase,
    percent: syncPercent,
    startedAt: syncStartTime,
  };
}
