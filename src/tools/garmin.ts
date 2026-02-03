import { toolRegistry } from "./registry";
import {
  syncGarmin,
  getTodaysSummary,
  getRecentActivities,
  getActivityDetails,
  getSleepTrend,
  getWeightTrend,
  getBodyBatteryTrend,
  queryGarmin,
} from "../garmin";

// sync_garmin
toolRegistry.register(
  {
    name: "sync_garmin",
    description:
      "Force refresh data from Garmin Connect. Use when data might be stale or user just completed an activity.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    const result = await syncGarmin();
    if (result.success) {
      return { synced: true, durationMs: result.durationMs };
    } else {
      return { synced: false, error: result.error };
    }
  }
);

// get_todays_summary
toolRegistry.register(
  {
    name: "get_todays_summary",
    description:
      "Get today's health summary: steps, sleep score, stress, body battery, resting HR.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    return getTodaysSummary();
  }
);

// get_recent_activities
toolRegistry.register(
  {
    name: "get_recent_activities",
    description:
      "Get recent activities (runs, walks, rides, etc.) with distance, duration, HR, pace.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 7)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getRecentActivities(days);
  }
);

// get_activity_details
toolRegistry.register(
  {
    name: "get_activity_details",
    description:
      "Get detailed breakdown of a specific activity: HR zones, pace splits, cadence.",
    parameters: {
      type: "object",
      properties: {
        activity_id: {
          type: "string",
          description: "The activity ID to look up",
        },
      },
      required: ["activity_id"],
    },
  },
  async (args) => {
    const id = String(args.activity_id);
    return getActivityDetails(id);
  }
);

// get_sleep_trend
toolRegistry.register(
  {
    name: "get_sleep_trend",
    description:
      "Get sleep data over N days: duration, quality, deep/light/REM breakdown.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 7)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getSleepTrend(days);
  }
);

// get_weight_trend
toolRegistry.register(
  {
    name: "get_weight_trend",
    description: "Get weight measurements over N days.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 30)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 30;
    return getWeightTrend(days);
  }
);

// get_body_battery_trend
toolRegistry.register(
  {
    name: "get_body_battery_trend",
    description: "Get body battery (energy) patterns over N days.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 7)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getBodyBatteryTrend(days);
  }
);

// query_garmin (escape hatch)
toolRegistry.register(
  {
    name: "query_garmin",
    description:
      "Execute raw SQL query against Garmin database. Use sparingly for edge cases not covered by other tools.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SQL query to execute",
        },
        db_name: {
          type: "string",
          description:
            "Database file name: garmin.db, garmin_activities.db, garmin_summary.db, or garmin_monitoring.db",
          enum: [
            "garmin.db",
            "garmin_activities.db",
            "garmin_summary.db",
            "garmin_monitoring.db",
          ],
        },
      },
      required: ["sql"],
    },
  },
  async (args) => {
    const sql = String(args.sql);
    const dbName = typeof args.db_name === "string" ? args.db_name : "garmin.db";
    return queryGarmin(sql, dbName);
  }
);
