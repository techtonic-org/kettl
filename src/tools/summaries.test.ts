import { describe, test, expect, mock } from "bun:test";
import { toolRegistry } from "./registry";

// Mock summary module
mock.module("../summaries/generator", () => ({
  getSummary: (date: string) => {
    if (date === "2026-02-03") {
      return Promise.resolve("# Daily Summary - 2026-02-03\n\nGreat day!");
    }
    return Promise.resolve(null);
  },
}));

// Import tool registration
await import("./summaries");

describe("Summary Tools", () => {
  test("get_daily_summary tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_daily_summary");
    expect(tool).toBeDefined();
    expect(tool?.parameters.properties.date).toBeDefined();
  });

  test("get_daily_summary returns summary for valid date", async () => {
    const result = await toolRegistry.execute({
      name: "get_daily_summary",
      args: { date: "2026-02-03" },
    });
    expect(result.result).toContain("Great day!");
  });

  test("get_daily_summary returns error for missing date", async () => {
    const result = await toolRegistry.execute({
      name: "get_daily_summary",
      args: { date: "2020-01-01" },
    });
    expect(result.result).toEqual({ error: "No summary found for 2020-01-01" });
  });
});
