import { toolRegistry } from "./registry";
import { getSummary } from "../summaries/generator";

// Tool: get_daily_summary
toolRegistry.register(
  {
    name: "get_daily_summary",
    description:
      "Get the daily summary for a specific date. " +
      "Returns a markdown document with activities, vitals, sleep, " +
      "and chat interactions from that day. " +
      "Use for reviewing past days or answering 'what happened on X date'.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (e.g., 2026-02-03)",
        },
      },
      required: ["date"],
    },
  },
  async (args: { date: string }) => {
    const summary = await getSummary(args.date);

    if (!summary) {
      return { error: `No summary found for ${args.date}` };
    }

    return summary;
  }
);
