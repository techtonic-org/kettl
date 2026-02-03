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
