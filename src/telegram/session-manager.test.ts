// src/telegram/session-manager.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

testDir = await mkdtemp(join(tmpdir(), "session-mgr-test-"));

mock.module("../config", () => ({
  config: {
    sessionsPath: testDir,
    timezone: "UTC",
  },
}));

const { SessionManager } = await import("./session-manager");

afterEach(async () => {
  const files = await readdir(testDir);
  for (const f of files) {
    await rm(join(testDir, f), { force: true });
  }
});

process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("SessionManager", () => {
  test("getOrCreateSession creates new session when none exists", async () => {
    const manager = new SessionManager();
    const session = await manager.getOrCreateSession("user-123");

    expect(session.messages).toEqual([]);
    expect(session.meta.userId).toBe("user-123");
  });

  test("getOrCreateSession returns existing active session", async () => {
    const manager = new SessionManager();

    const session1 = await manager.getOrCreateSession("user-123");
    const session2 = await manager.getOrCreateSession("user-123");

    expect(session1.filename).toBe(session2.filename);
  });

  test("clear resets session", async () => {
    const manager = new SessionManager();

    await manager.getOrCreateSession("user-123");
    manager.clear();

    const session = await manager.getOrCreateSession("user-123");
    // Should be a new session (different timestamp)
    expect(session.messages).toEqual([]);
  });
});
