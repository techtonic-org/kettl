import { toolRegistry } from "./registry";
import {
  getCurrentVitals,
  getLatestActivities,
  getTodaysSleep,
} from "../garmin/instant";

// Tool: get_current_vitals
toolRegistry.register(
  {
    name: "get_current_vitals",
    description:
      "Get real-time vitals from Garmin (steps, HR, stress, body battery). " +
      "Use this for current state queries - always fresh, no sync needed.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    return await getCurrentVitals();
  }
);

// Tool: get_latest_activities
toolRegistry.register(
  {
    name: "get_latest_activities",
    description:
      "Get recent activities directly from Garmin API. " +
      "Use this for activities that happened since last SQLite sync, " +
      "especially if sync was >1 hour ago.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of activities to fetch (default: 10, max: 50)",
        },
      },
    },
  },
  async (args: { limit?: number }) => {
    const limit = Math.min(args.limit ?? 10, 50);
    return await getLatestActivities(limit);
  }
);

// Tool: get_todays_sleep_instant
toolRegistry.register(
  {
    name: "get_todays_sleep_instant",
    description:
      "Get last night's sleep data directly from Garmin API. " +
      "Use this for sleep queries before SQLite has synced today's data.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    const sleep = await getTodaysSleep();
    if (!sleep) {
      return { error: "No sleep data available for today" };
    }
    return {
      totalSleepMinutes: Math.round(sleep.totalSleep / 60),
      deepSleepMinutes: Math.round(sleep.deepSleep / 60),
      lightSleepMinutes: Math.round(sleep.lightSleep / 60),
      remSleepMinutes: Math.round(sleep.remSleep / 60),
      score: sleep.score,
    };
  }
);
