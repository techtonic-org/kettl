// src/sessions/store.ts
import { mkdir, appendFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import type { GeminiMessage } from "../agent/gemini";

export interface SessionMeta {
  _meta: true;
  startedAt: string;
  userId: string;
}

export type SessionEntry = SessionMeta | GeminiMessage;

export function getSessionFileName(date: Date): string {
  const iso = date.toISOString();
  // Format: YYYY-MM-DDTHH-mm-ss.jsonl (replace colons for filesystem safety)
  return iso.slice(0, 19).replace(/:/g, "-") + ".jsonl";
}

function getSessionFilePath(filename: string): string {
  return join(config.sessionsPath, filename);
}

export async function createSession(
  startTime: Date,
  userId: string
): Promise<string> {
  const filename = getSessionFileName(startTime);
  const filePath = getSessionFilePath(filename);

  await mkdir(config.sessionsPath, { recursive: true });

  const meta: SessionMeta = {
    _meta: true,
    startedAt: startTime.toISOString(),
    userId,
  };

  await appendFile(filePath, JSON.stringify(meta) + "\n");
  return filename;
}

export async function appendToSession(
  filename: string,
  entry: GeminiMessage
): Promise<void> {
  const filePath = getSessionFilePath(filename);
  await appendFile(filePath, JSON.stringify(entry) + "\n");
}

export interface LoadedSession {
  meta: SessionMeta;
  messages: GeminiMessage[];
  filename: string;
}

export async function loadSession(filename: string): Promise<LoadedSession | null> {
  const filePath = getSessionFilePath(filename);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  const lines = content.trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const meta = JSON.parse(lines[0]) as SessionMeta;
  const messages = lines.slice(1).map((line) => JSON.parse(line) as GeminiMessage);

  return { meta, messages, filename };
}

export async function getActiveSession(
  expiryHours: number
): Promise<LoadedSession | null> {
  const sessions = await getRecentSessions(1);

  if (sessions.length === 0) {
    return null;
  }

  const latest = sessions[0];
  const sessionAge = Date.now() - new Date(latest.meta.startedAt).getTime();
  const expiryMs = expiryHours * 60 * 60 * 1000;

  if (sessionAge > expiryMs) {
    return null;
  }

  return latest;
}

export async function getRecentSessions(limit: number): Promise<LoadedSession[]> {
  try {
    const files = await readdir(config.sessionsPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort().reverse();

    const sessions: LoadedSession[] = [];

    for (const filename of jsonlFiles.slice(0, limit)) {
      const session = await loadSession(filename);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  } catch (err) {
    // Directory doesn't exist yet
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}
