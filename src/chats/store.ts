import { mkdir, appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { config } from "../config";

export interface ChatEntry {
  time: string;
  user: string;
  assistant: string;
}

function getDateString(date: Date): string {
  // Format as YYYY-MM-DD in configured timezone
  return date.toLocaleDateString("en-CA", { timeZone: config.timezone });
}

function getTimeString(date: Date): string {
  // Format as HH:MM in configured timezone
  return date.toLocaleTimeString("en-GB", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getChatFilePath(dateStr: string): string {
  return join(config.chatsPath, `${dateStr}.jsonl`);
}

export async function appendChat(
  userMessage: string,
  assistantResponse: string,
  timestamp: Date = new Date()
): Promise<void> {
  const dateStr = getDateString(timestamp);
  const timeStr = getTimeString(timestamp);
  const filePath = getChatFilePath(dateStr);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  const entry: ChatEntry = {
    time: timeStr,
    user: userMessage,
    assistant: assistantResponse,
  };

  const line = JSON.stringify(entry) + "\n";
  await appendFile(filePath, line);
}

export async function getChatsForDate(dateStr: string): Promise<ChatEntry[]> {
  const filePath = getChatFilePath(dateStr);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as ChatEntry);
}
