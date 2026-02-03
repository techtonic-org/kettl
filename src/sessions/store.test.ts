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
