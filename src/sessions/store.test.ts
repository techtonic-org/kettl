// src/sessions/store.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GeminiMessage } from "../agent/gemini";

let testDir: string;

testDir = await mkdtemp(join(tmpdir(), "sessions-test-"));

mock.module("../config", () => ({
  config: {
    sessionsPath: testDir,
    timezone: "UTC",
  },
}));

const { getSessionFileName } = await import("./store");

afterEach(async () => {
  const files = await readdir(testDir);
  for (const f of files) {
    await rm(join(testDir, f), { force: true });
  }
});

process.on("beforeExit", async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Session Store", () => {
  test("getSessionFileName returns ISO-formatted filename", () => {
    const date = new Date("2026-02-03T14:30:45.123Z");
    const name = getSessionFileName(date);
    expect(name).toBe("2026-02-03T14-30-45.jsonl");
  });
});

describe("createSession", () => {
  test("creates session file with metadata", async () => {
    const { createSession, getSessionFileName } = await import("./store");

    const startTime = new Date("2026-02-03T14:30:45Z");
    await createSession(startTime, "test-user");

    const expectedFile = join(testDir, getSessionFileName(startTime));
    const content = await Bun.file(expectedFile).text();
    const meta = JSON.parse(content.trim());

    expect(meta._meta).toBe(true);
    expect(meta.startedAt).toBe("2026-02-03T14:30:45.000Z");
    expect(meta.userId).toBe("test-user");
  });
});

describe("appendToSession", () => {
  test("appends message to session file", async () => {
    const { createSession, appendToSession, getSessionFileName } = await import("./store");

    const startTime = new Date("2026-02-03T14:30:45Z");
    await createSession(startTime, "test-user");

    const message: GeminiMessage = {
      role: "user",
      parts: [{ text: "Hello" }],
    };
    await appendToSession(getSessionFileName(startTime), message);

    const expectedFile = join(testDir, getSessionFileName(startTime));
    const lines = (await Bun.file(expectedFile).text()).trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toEqual(message);
  });
});

describe("loadSession", () => {
  test("loads all messages from session file", async () => {
    const { createSession, appendToSession, loadSession, getSessionFileName } = await import("./store");

    const startTime = new Date("2026-02-03T14:30:45Z");
    await createSession(startTime, "test-user");

    const filename = getSessionFileName(startTime);
    await appendToSession(filename, { role: "user", parts: [{ text: "Hello" }] });
    await appendToSession(filename, { role: "model", parts: [{ text: "Hi there!" }] });

    const session = await loadSession(filename);

    expect(session.meta.startedAt).toBe("2026-02-03T14:30:45.000Z");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe("user");
    expect(session.messages[1].role).toBe("model");
  });

  test("returns null for missing session", async () => {
    const { loadSession } = await import("./store");

    const session = await loadSession("nonexistent.jsonl");
    expect(session).toBeNull();
  });
});

describe("getActiveSession", () => {
  test("returns most recent session if within expiry window", async () => {
    const { createSession, getActiveSession, getSessionFileName } = await import("./store");

    // Create session 1 hour ago (within 4 hour window)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await createSession(oneHourAgo, "test-user");

    const session = await getActiveSession(4);

    expect(session).not.toBeNull();
    expect(session!.filename).toBe(getSessionFileName(oneHourAgo));
  });

  test("returns null if session is expired", async () => {
    const { createSession, getActiveSession } = await import("./store");

    // Create session 5 hours ago (outside 4 hour window)
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await createSession(fiveHoursAgo, "test-user");

    const session = await getActiveSession(4);

    expect(session).toBeNull();
  });

  test("returns null if no sessions exist", async () => {
    const { getActiveSession } = await import("./store");

    const session = await getActiveSession(4);
    expect(session).toBeNull();
  });
});

describe("getRecentSessions", () => {
  test("returns sessions sorted by most recent first", async () => {
    const { createSession, getRecentSessions } = await import("./store");

    const time1 = new Date("2026-02-03T10:00:00Z");
    const time2 = new Date("2026-02-03T12:00:00Z");
    const time3 = new Date("2026-02-03T14:00:00Z");

    await createSession(time1, "user");
    await createSession(time2, "user");
    await createSession(time3, "user");

    const sessions = await getRecentSessions(5);

    expect(sessions).toHaveLength(3);
    expect(sessions[0].meta.startedAt).toBe(time3.toISOString());
    expect(sessions[1].meta.startedAt).toBe(time2.toISOString());
    expect(sessions[2].meta.startedAt).toBe(time1.toISOString());
  });

  test("limits number of sessions returned", async () => {
    const { createSession, getRecentSessions } = await import("./store");

    for (let i = 0; i < 10; i++) {
      await createSession(new Date(Date.now() - i * 60000), "user");
    }

    const sessions = await getRecentSessions(3);
    expect(sessions).toHaveLength(3);
  });
});
