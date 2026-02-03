// src/sessions/integration.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "bun:test";

let testDir: string;

testDir = await mkdtemp(join(tmpdir(), "integration-test-"));

mock.module("../config", () => ({
  config: {
    sessionsPath: testDir,
    timezone: "UTC",
  },
}));

const {
  createSession,
  appendToSession,
  loadSession,
  getActiveSession,
  getSessionFileName,
} = await import("./store");

afterEach(async () => {
  const files = await readdir(testDir);
  for (const f of files) {
    await rm(join(testDir, f), { force: true });
  }
});

process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Session Integration", () => {
  test("full conversation flow persists and reloads", async () => {
    // 1. Create session
    const startTime = new Date();
    const filename = await createSession(startTime, "test-user");

    // 2. Simulate conversation
    await appendToSession(filename, {
      role: "user",
      parts: [{ text: "How did I sleep last night?" }],
    });
    await appendToSession(filename, {
      role: "model",
      parts: [{ text: "Let me check your sleep data..." }],
    });
    await appendToSession(filename, {
      role: "function",
      parts: [{
        functionResponse: {
          name: "get_todays_sleep_instant",
          response: { result: { duration: 7.5, score: 85 } },
        },
      }],
    });
    await appendToSession(filename, {
      role: "model",
      parts: [{ text: "You slept 7.5 hours with a score of 85!" }],
    });

    // 3. Reload session
    const loaded = await loadSession(filename);

    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(4);
    expect(loaded!.messages[0].role).toBe("user");
    expect(loaded!.messages[3].role).toBe("model");

    // 4. Verify getActiveSession finds it
    const active = await getActiveSession(4);
    expect(active).not.toBeNull();
    expect(active!.filename).toBe(filename);
  });
});
