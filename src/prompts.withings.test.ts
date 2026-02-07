import { describe, test, expect } from "bun:test";
import { buildMainPrompt, type PromptContext } from "./prompts";

const context: PromptContext = {
  lastSyncTime: new Date("2026-02-03T10:00:00Z"),
  lastSyncAgo: "2 hours ago",
  messageTime: new Date("2026-02-03T12:00:00Z"),
  messageTimeLocal: "12:00",
};

describe("Withings in system prompt", () => {
  test("includes Body Composition (Withings) section", () => {
    const prompt = buildMainPrompt(context);
    expect(prompt).toContain("Body Composition (Withings)");
  });

  test("lists get_latest_weight tool", () => {
    const prompt = buildMainPrompt(context);
    expect(prompt).toContain("get_latest_weight");
  });

  test("get_weight_trend is NOT in SQLite tools list", () => {
    const prompt = buildMainPrompt(context);
    // get_weight_trend should appear in Withings section, not in SQLite section
    const sqliteSection = prompt.split("**SQLite Data")[1]?.split("**")[0] ?? "";
    expect(sqliteSection).not.toContain("get_weight_trend");
  });

  test("mentions body composition metrics", () => {
    const prompt = buildMainPrompt(context);
    expect(prompt).toContain("body fat");
    expect(prompt).toContain("muscle mass");
    expect(prompt).toContain("BMI");
  });
});
