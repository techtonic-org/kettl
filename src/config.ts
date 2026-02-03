import { join } from "path";
import { homedir } from "os";

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export const config = {
  // Garmin - garmindb stores DBs at ~/HealthData/DBs/ by default
  garminDbPath: expandPath(
    getEnvOrDefault("GARMINDB_PATH", "~/HealthData/DBs")
  ),

  // Garmin credentials (for config generation)
  garminEmail: () => getEnvOrThrow("GARMIN_EMAIL"),
  garminPassword: () => getEnvOrThrow("GARMIN_PASSWORD"),

  // Telegram
  telegramBotToken: () => getEnvOrThrow("TELEGRAM_BOT_TOKEN"),

  // Gemini
  geminiApiKey: () => getEnvOrThrow("GEMINI_API_KEY"),

  // Mem0
  mem0Url: getEnvOrDefault("MEM0_URL", "http://localhost:8080"),

  // Timeouts (ms)
  garminSyncTimeout: 30_000,
  geminiTimeout: 60_000,
  overallTimeout: 90_000,

  // Sync scheduling
  garminSyncIntervalHours: parseInt(
    getEnvOrDefault("GARMIN_SYNC_INTERVAL_HOURS", "4"),
    10
  ),

  // Daily summaries
  summaryHour: parseInt(getEnvOrDefault("SUMMARY_HOUR", "0"), 10),
  summariesPath: expandPath(
    getEnvOrDefault("SUMMARIES_PATH", "./data/summaries")
  ),
  chatsPath: expandPath(getEnvOrDefault("CHATS_PATH", "./data/chats")),

  // Timezone for scheduling (defaults to system timezone)
  timezone: getEnvOrDefault("TZ", "UTC"),
} as const;
