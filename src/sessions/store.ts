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
