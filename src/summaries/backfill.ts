import { generateDailySummary, summaryExists } from "./generator";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getDateRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  let current = new Date(startDate);

  while (current <= endDate) {
    dates.push(formatDate(current));
    current = addDays(current, 1);
  }

  return dates;
}

export async function getMissingDates(
  startDate: Date,
  endDate: Date
): Promise<string[]> {
  const allDates = getDateRange(startDate, endDate);
  const missing: string[] = [];

  for (const dateStr of allDates) {
    if (!(await summaryExists(dateStr))) {
      missing.push(dateStr);
    }
  }

  return missing;
}

export interface BackfillProgress {
  total: number;
  completed: number;
  current: string | null;
  errors: string[];
}

let backfillProgress: BackfillProgress | null = null;
let backfillRunning = false;

export async function runBackfill(
  startDate: Date,
  endDate: Date,
  options: { delayMs?: number } = {}
): Promise<BackfillProgress> {
  const { delayMs = 1500 } = options;

  if (backfillRunning) {
    console.log("[Backfill] Already running, skipping");
    return backfillProgress!;
  }

  backfillRunning = true;

  try {
    const missingDates = await getMissingDates(startDate, endDate);

    backfillProgress = {
      total: missingDates.length,
      completed: 0,
      current: null,
      errors: [],
    };

    if (missingDates.length === 0) {
      console.log("[Backfill] No missing summaries to generate");
      return backfillProgress;
    }

    console.log(`[Backfill] Generating ${missingDates.length} missing summaries`);

    for (const dateStr of missingDates) {
      backfillProgress.current = dateStr;

      try {
        await generateDailySummary(dateStr);
        backfillProgress.completed++;
        console.log(
          `[Backfill] Progress: ${backfillProgress.completed}/${backfillProgress.total}`
        );
      } catch (error) {
        const errorMsg = `Failed to generate ${dateStr}: ${error}`;
        console.error(`[Backfill] ${errorMsg}`);
        backfillProgress.errors.push(errorMsg);
      }

      // Delay between generations to avoid rate limits
      if (backfillProgress.completed < missingDates.length && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    backfillProgress.current = null;

    console.log(
      `[Backfill] Complete: ${backfillProgress.completed}/${backfillProgress.total}, ` +
        `${backfillProgress.errors.length} errors`
    );

    return backfillProgress;
  } finally {
    backfillRunning = false;
  }
}

export function getBackfillProgress(): BackfillProgress | null {
  return backfillProgress;
}

export function isBackfillRunning(): boolean {
  return backfillRunning;
}
