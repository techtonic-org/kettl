import { toolRegistry } from "./registry";
import { withingsAdapter } from "../adapters/withings";

// get_latest_weight
toolRegistry.register(
  {
    name: "get_latest_weight",
    description:
      "Get the most recent body composition measurement (weight, fat%, muscle mass, bone mass, water%, BMI).",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    return withingsAdapter.getLatest();
  }
);

// get_weight_trend
toolRegistry.register(
  {
    name: "get_weight_trend",
    description:
      "Get body composition measurements over N days. Includes weight, fat%, muscle mass, bone mass, water%, BMI.",
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
    return withingsAdapter.getTrend(days);
  }
);
