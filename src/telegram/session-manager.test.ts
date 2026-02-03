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

  test("hasActiveSession returns true when session exists", async () => {
    const manager = new SessionManager();

    expect(manager.hasActiveSession()).toBe(false);
    await manager.getOrCreateSession("user-123");
    expect(manager.hasActiveSession()).toBe(true);
  });

  test("hasActiveSession returns false after clear", async () => {
    const manager = new SessionManager();

    await manager.getOrCreateSession("user-123");
    expect(manager.hasActiveSession()).toBe(true);
    manager.clear();
    expect(manager.hasActiveSession()).toBe(false);
  });

  test("appendMessages adds messages to session", async () => {
    const manager = new SessionManager();
    await manager.getOrCreateSession("user-123");

    await manager.appendMessages([
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi there!" }] },
    ]);

    const session = await manager.getOrCreateSession("user-123");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1].role).toBe("model");
  });

  test("appendMessages throws when no active session", async () => {
    const manager = new SessionManager();

    expect(
      manager.appendMessages([{ role: "user", parts: [{ text: "Hello" }] }])
    ).rejects.toThrow("No active session");
  });
});
