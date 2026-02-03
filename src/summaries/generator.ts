import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { config } from "../config";
import {
  getSummaryForDate,
  getActivitiesForDate,
  getSleepForDate,
} from "../garmin/queries";
import { getChatsForDate, type ChatEntry } from "../chats/store";
import { chat } from "../agent/gemini";
import { saveInsight } from "../memory/client";

export function getSummaryFilePath(dateStr: string): string {
  return join(config.summariesPath, `${dateStr}.md`);
}

const SUMMARY_GENERATION_PROMPT = `You are generating a daily health summary. Based on the data provided, create a concise, well-structured markdown summary.

Format:
# Daily Summary - {date}

## Activities
- List each activity with key metrics (distance, time, HR)
- If no activities, say "No recorded activities"

## Vitals
- Steps, Resting HR, Stress avg, Body Battery range
- Note any notable patterns

## Sleep (previous night)
- Total sleep, stages breakdown, score
- Note quality observations

## Chat Interactions
- Brief summary of what was discussed (if any)
- Key decisions or insights from conversations

## Patterns Noticed
- Any trends compared to typical
- Observations worth remembering

Keep it factual and concise. No fluff.`;

interface GenerateOptions {
  overwrite?: boolean;
}

export async function generateDailySummary(
  dateStr: string,
  options: GenerateOptions = {}
): Promise<string> {
  const { overwrite = false } = options;
  const filePath = getSummaryFilePath(dateStr);

  // Check if file already exists
  const file = Bun.file(filePath);
  if ((await file.exists()) && !overwrite) {
    console.log(`[Summary] Summary for ${dateStr} already exists, skipping`);
    return await file.text();
  }

  console.log(`[Summary] Generating summary for ${dateStr}`);

  // Gather data for the specific date
  const [vitals, activities, sleep, chats] = await Promise.all([
    getSummaryForDate(dateStr),
    getActivitiesForDate(dateStr),
    getSleepForDate(dateStr),
    getChatsForDate(dateStr),
  ]);

  // Build data context for LLM
  const dataContext = buildDataContext(dateStr, vitals, activities, sleep, chats);

  // Generate summary with Gemini
  const response = await chat(
    [{ role: "user", parts: [{ text: dataContext }] }],
    [],
    SUMMARY_GENERATION_PROMPT
  );

  const summaryContent = response.text || "";

  // Ensure directory exists and write file
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, summaryContent);

  // Save to Mem0
  try {
    await saveInsight(
      `Daily summary for ${dateStr}:\n${summaryContent}`,
      "weekly_summaries"
    );
    console.log(`[Summary] Saved ${dateStr} summary to Mem0`);
  } catch (error) {
    console.error(`[Summary] Failed to save to Mem0:`, error);
  }

  console.log(`[Summary] Generated summary for ${dateStr}`);
  return summaryContent;
}

interface DailySummaryData {
  date?: string;
  steps?: number | null;
  rhr?: number | null;
  stress_avg?: number | null;
  bb_max?: number | null;
  bb_min?: number | null;
}

interface ActivityData {
  name?: string;
  type?: string;
  distance?: number | null;
  elapsed_time?: string | null;  // SQLite returns time as string "HH:MM:SS.mmm"
  avg_hr?: number | null;
  max_hr?: number | null;
}

interface SleepData {
  total_sleep?: string | null;  // SQLite returns time as string "HH:MM:SS.mmm"
  deep_sleep?: string | null;
  light_sleep?: string | null;
  rem_sleep?: string | null;
  score?: number | null;
}

function buildDataContext(
  dateStr: string,
  vitals: DailySummaryData | null,
  activities: ActivityData[],
  sleep: SleepData | null,
  chats: ChatEntry[]
): string {
  const sections: string[] = [`Date: ${dateStr}`, ""];

  // Vitals
  if (vitals) {
    sections.push("VITALS DATA:");
    sections.push(`- Steps: ${vitals.steps ?? "N/A"}`);
    sections.push(`- Resting HR: ${vitals.rhr ?? "N/A"} bpm`);
    sections.push(`- Stress avg: ${vitals.stress_avg ?? "N/A"}`);
    sections.push(
      `- Body Battery: ${vitals.bb_min ?? "N/A"} → ${vitals.bb_max ?? "N/A"}`
    );
    // Include sleep summary in vitals
    if (sleep) {
      sections.push(`- Sleep: ${formatTimeString(sleep.total_sleep)} (score: ${sleep.score ?? "N/A"})`);
    }
    sections.push("");
  } else {
    sections.push("VITALS DATA: No data available");
    sections.push("");
  }

  // Activities
  sections.push("ACTIVITIES:");
  if (activities.length > 0) {
    for (const act of activities) {
      sections.push(
        `- ${act.name} (${act.type}): ${formatDistanceKm(act.distance)}, ` +
          `${formatTimeString(act.elapsed_time)}, avg HR ${act.avg_hr ?? "N/A"}, ` +
          `max HR ${act.max_hr ?? "N/A"}`
      );
    }
  } else {
    sections.push("No recorded activities");
  }
  sections.push("");

  // Sleep
  sections.push("SLEEP (previous night):");
  if (sleep) {
    sections.push(`- Total: ${formatTimeString(sleep.total_sleep)}`);
    sections.push(`- Deep: ${formatTimeString(sleep.deep_sleep)}`);
    sections.push(`- Light: ${formatTimeString(sleep.light_sleep)}`);
    sections.push(`- REM: ${formatTimeString(sleep.rem_sleep)}`);
    sections.push(`- Score: ${sleep.score ?? "N/A"}`);
  } else {
    sections.push("No sleep data available");
  }
  sections.push("");

  // Chats
  sections.push("CHAT INTERACTIONS:");
  if (chats.length > 0) {
    for (const c of chats) {
      sections.push(`[${c.time}]`);
      sections.push(`User: ${truncate(c.user, 100)}`);
      sections.push(`Assistant: ${truncate(c.assistant, 200)}`);
      sections.push("");
    }
  } else {
    sections.push("No chat interactions recorded");
  }

  return sections.join("\n");
}

function formatDistanceKm(km: number | null | undefined): string {
  if (km == null || km === 0) return "N/A";
  return `${km.toFixed(2)}km`;
}

// Format time strings like "01:01:42.743000" or "05:55:00.000000"
function formatTimeString(timeStr: string | null | undefined): string {
  if (!timeStr) return "N/A";
  // Parse HH:MM:SS from the string
  const match = timeStr.match(/^(\d+):(\d+):(\d+)/);
  if (!match) return timeStr;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

export async function summaryExists(dateStr: string): Promise<boolean> {
  const file = Bun.file(getSummaryFilePath(dateStr));
  return await file.exists();
}

export async function getSummary(dateStr: string): Promise<string | null> {
  const file = Bun.file(getSummaryFilePath(dateStr));
  if (!(await file.exists())) {
    return null;
  }
  return await file.text();
}
