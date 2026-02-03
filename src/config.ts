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
  // Garmin
  garminDbPath: expandPath(
    getEnvOrDefault("GARMINDB_PATH", "~/.GarminDb/HealthData")
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
} as const;
