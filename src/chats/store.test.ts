import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

// Set up testDir before mocking
testDir = await mkdtemp(join(tmpdir(), "chats-test-"));

// Mock config at top level with test directory
mock.module("../config", () => ({
  config: {
    chatsPath: testDir,
    timezone: "UTC",
  },
}));

// Import after mocking
const { appendChat, getChatsForDate } = await import("./store");

afterEach(async () => {
  // Clean up files but keep directory
  const files = await Bun.file(join(testDir, "2026-02-03.jsonl")).exists()
    ? [join(testDir, "2026-02-03.jsonl")]
    : [];
  for (const f of files) {
    await rm(f, { force: true });
  }
});

// Final cleanup
process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Chat Store", () => {
  test("appendChat creates directory and file if not exists", async () => {
    await appendChat("Hello", "Hi there!", new Date("2026-02-03T14:30:00Z"));

    const chats = await getChatsForDate("2026-02-03");
    expect(chats).toHaveLength(1);
    expect(chats[0].user).toBe("Hello");
    expect(chats[0].assistant).toBe("Hi there!");
  });

  test("appendChat appends to existing file", async () => {
    await appendChat("First", "First reply", new Date("2026-02-03T10:00:00Z"));
    await appendChat("Second", "Second reply", new Date("2026-02-03T11:00:00Z"));

    const chats = await getChatsForDate("2026-02-03");
    expect(chats).toHaveLength(2);
  });

  test("getChatsForDate returns empty array for missing date", async () => {
    const chats = await getChatsForDate("2026-01-01");
    expect(chats).toEqual([]);
  });
});
