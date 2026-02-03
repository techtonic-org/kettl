import { describe, test, expect } from "bun:test";
import { buildMainPrompt, PromptContext } from "./prompts";

describe("Dynamic Prompts", () => {
  test("buildMainPrompt includes sync time", () => {
    const context: PromptContext = {
      lastSyncTime: new Date("2026-02-03T10:00:00Z"),
      lastSyncAgo: "2 hours ago",
      messageTime: new Date("2026-02-03T12:00:00Z"),
      messageTimeLocal: "12:00",
    };

    const prompt = buildMainPrompt(context);

    expect(prompt).toContain("2 hours ago");
    expect(prompt).toContain("12:00");
  });

  test("buildMainPrompt includes data freshness guidance", () => {
    const context: PromptContext = {
      lastSyncTime: new Date("2026-02-03T10:00:00Z"),
      lastSyncAgo: "2 hours ago",
      messageTime: new Date("2026-02-03T12:00:00Z"),
      messageTimeLocal: "12:00",
    };

    const prompt = buildMainPrompt(context);

    expect(prompt).toContain("SQLite Data");
    expect(prompt).toContain("Instant API");
    expect(prompt).toContain("Daily Summaries");
  });

  test("buildMainPrompt includes rule of thumb", () => {
    const context: PromptContext = {
      lastSyncTime: new Date("2026-02-03T10:00:00Z"),
      lastSyncAgo: "5 hours ago",
      messageTime: new Date("2026-02-03T15:00:00Z"),
      messageTimeLocal: "15:00",
    };

    const prompt = buildMainPrompt(context);

    expect(prompt).toContain("prefer instant API");
  });
});
