// src/sessions/store.test.ts
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
