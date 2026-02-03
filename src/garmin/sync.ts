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

  // Write config file
  const garminConfig = {
    credentials: {
      user: email,
      password: password,
    },
    data: {
      weight_start_date: "2020-01-01",
      sleep_start_date: "2020-01-01",
    },
    copy: {
      mount_dir: "",
    },
    enabled_stats: {
      monitoring: true,
      sleep: true,
      rhr: true,
      weight: true,
      activities: true,
    },
  };

  await Bun.write(configPath, JSON.stringify(garminConfig, null, 2));
}

export async function syncGarmin(): Promise<SyncResult> {
  const start = Date.now();

  try {
    // Ensure config exists before syncing
    await ensureGarminConfig();

    const proc = spawn({
      cmd: ["garmindb_cli.py", "--all", "--download", "--import", "--analyze"],
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
  const start = Date.now();

  try {
    await ensureGarminConfig();

    const proc = spawn({
      cmd: ["garmindb_cli.py", "--all", "--download", "--import", "--analyze"],
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    const durationMs = Date.now() - start;

    if (exitCode === 0) {
      console.log(`Background Garmin sync completed in ${Math.round(durationMs / 1000)}s`);
    } else {
      console.error(`Background Garmin sync failed with exit code ${exitCode}`);
    }
  } catch (error) {
    console.error("Background Garmin sync error:", error);
  } finally {
    backgroundSyncRunning = false;
  }
}

export function isBackgroundSyncRunning(): boolean {
  return backgroundSyncRunning;
}
