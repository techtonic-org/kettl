# Garmin Real-time API & Daily Summaries Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time Garmin API access, scheduled SQLite syncs, daily summary generation, and chat persistence to Kettl.

**Architecture:** Two-tier data system with SQLite (4-hour scheduled sync) for historical queries and instant Garmin Connect API for real-time data. Daily summaries generated at EOD combine health metrics with chat interactions, stored as markdown and loaded into Mem0.

**Tech Stack:** Bun, TypeScript, garmin-connect (npm), Mem0, Telegram (grammY), Gemini 2.0-flash

---

## Task 1: Add Configuration for New Features

**Files:**
- Modify: `src/config.ts:1-47`

**Step 1: Add new environment variables to config**

Add these exports to `src/config.ts` after line 47:

```typescript
// Sync scheduling
export const garminSyncIntervalHours = parseInt(
  getEnvOrDefault("GARMIN_SYNC_INTERVAL_HOURS", "4"),
  10
);

// Daily summaries
export const summaryHour = parseInt(
  getEnvOrDefault("SUMMARY_HOUR", "0"),
  10
);
export const summariesPath = expandPath(
  getEnvOrDefault("SUMMARIES_PATH", "./data/summaries")
);
export const chatsPath = expandPath(
  getEnvOrDefault("CHATS_PATH", "./data/chats")
);

// Timezone for scheduling (defaults to system timezone)
export const timezone = getEnvOrDefault("TZ", "UTC");
```

**Step 2: Verify config loads correctly**

Run: `bun -e "import * as c from './src/config'; console.log(c)"`
Expected: All new properties appear with defaults

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "$(cat <<'EOF'
feat: add config for sync scheduling and daily summaries

Adds GARMIN_SYNC_INTERVAL_HOURS, SUMMARY_HOUR, SUMMARIES_PATH,
CHATS_PATH, and TZ environment variables.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Install garmin-connect Dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

Run: `bun add garmin-connect`

**Step 2: Verify installation**

Run: `bun -e "import { GarminConnect } from 'garmin-connect'; console.log('OK')"`
Expected: `OK` (no import errors)

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "$(cat <<'EOF'
deps: add garmin-connect for real-time API access

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create Instant Garmin API Client

**Files:**
- Create: `src/garmin/instant.ts`
- Modify: `src/garmin/index.ts`

**Step 1: Write the failing test**

Create `src/garmin/instant.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock garmin-connect before importing instant
const mockLogin = mock(() => Promise.resolve());
const mockGetUserSummary = mock(() =>
  Promise.resolve({
    totalSteps: 8000,
    restingHeartRate: 55,
    maxStressLevel: 45,
    bodyBatteryHighestValue: 80,
    bodyBatteryLowestValue: 30,
  })
);
const mockGetActivities = mock(() =>
  Promise.resolve([
    { activityId: 123, activityName: "Morning Run", startTimeLocal: "2026-02-03" },
  ])
);
const mockGetSleep = mock(() =>
  Promise.resolve({
    dailySleepDTO: {
      sleepTimeSeconds: 25200,
      deepSleepSeconds: 6300,
      lightSleepSeconds: 14400,
      remSleepSeconds: 4500,
      sleepScores: { overall: { value: 82 } },
    },
  })
);

mock.module("garmin-connect", () => ({
  GarminConnect: class {
    login = mockLogin;
    getUserSummary = mockGetUserSummary;
    getActivities = mockGetActivities;
    getSleep = mockGetSleep;
  },
}));

const { initInstantClient, getCurrentVitals, getLatestActivities, getTodaysSleep } = await import(
  "./instant"
);

describe("Instant Garmin Client", () => {
  beforeEach(() => {
    mockLogin.mockClear();
    mockGetUserSummary.mockClear();
    mockGetActivities.mockClear();
    mockGetSleep.mockClear();
  });

  test("initInstantClient authenticates on first call", async () => {
    await initInstantClient();
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  test("getCurrentVitals returns formatted vitals", async () => {
    const vitals = await getCurrentVitals();
    expect(vitals).toEqual({
      steps: 8000,
      restingHr: 55,
      stressLevel: 45,
      bodyBatteryHigh: 80,
      bodyBatteryLow: 30,
    });
  });

  test("getLatestActivities returns activities since date", async () => {
    const activities = await getLatestActivities(5);
    expect(mockGetActivities).toHaveBeenCalledWith(0, 5);
    expect(activities).toHaveLength(1);
    expect(activities[0].activityId).toBe(123);
  });

  test("getTodaysSleep returns formatted sleep data", async () => {
    const sleep = await getTodaysSleep();
    expect(sleep?.totalSleep).toBe(25200);
    expect(sleep?.score).toBe(82);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/garmin/instant.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/garmin/instant.ts`:

```typescript
import { GarminConnect } from "garmin-connect";
import * as config from "../config";

let client: GarminConnect | null = null;
let initialized = false;

export interface InstantVitals {
  steps: number;
  restingHr: number | null;
  stressLevel: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
}

export interface InstantActivity {
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeLocal: string;
  distance?: number;
  duration?: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
}

export interface InstantSleep {
  totalSleep: number;
  deepSleep: number;
  lightSleep: number;
  remSleep: number;
  score: number | null;
}

export async function initInstantClient(): Promise<void> {
  if (initialized && client) {
    return;
  }

  client = new GarminConnect();
  await client.login(config.garminEmail(), config.garminPassword());
  initialized = true;
  console.log("[Instant] Garmin Connect client initialized");
}

export async function getCurrentVitals(): Promise<InstantVitals> {
  if (!client) {
    await initInstantClient();
  }

  const today = new Date().toISOString().split("T")[0];
  const summary = await client!.getUserSummary(today);

  return {
    steps: summary.totalSteps ?? 0,
    restingHr: summary.restingHeartRate ?? null,
    stressLevel: summary.maxStressLevel ?? null,
    bodyBatteryHigh: summary.bodyBatteryHighestValue ?? null,
    bodyBatteryLow: summary.bodyBatteryLowestValue ?? null,
  };
}

export async function getLatestActivities(
  limit: number = 10
): Promise<InstantActivity[]> {
  if (!client) {
    await initInstantClient();
  }

  const activities = await client!.getActivities(0, limit);

  return activities.map((a: any) => ({
    activityId: a.activityId,
    activityName: a.activityName,
    activityType: a.activityType?.typeKey ?? "unknown",
    startTimeLocal: a.startTimeLocal,
    distance: a.distance,
    duration: a.duration,
    averageHR: a.averageHR,
    maxHR: a.maxHR,
    calories: a.calories,
  }));
}

export async function getTodaysSleep(): Promise<InstantSleep | null> {
  if (!client) {
    await initInstantClient();
  }

  const today = new Date().toISOString().split("T")[0];

  try {
    const sleep = await client!.getSleep(today);
    const dto = sleep?.dailySleepDTO;

    if (!dto) {
      return null;
    }

    return {
      totalSleep: dto.sleepTimeSeconds ?? 0,
      deepSleep: dto.deepSleepSeconds ?? 0,
      lightSleep: dto.lightSleepSeconds ?? 0,
      remSleep: dto.remSleepSeconds ?? 0,
      score: dto.sleepScores?.overall?.value ?? null,
    };
  } catch (error) {
    console.error("[Instant] Failed to get sleep data:", error);
    return null;
  }
}

export function isInstantClientInitialized(): boolean {
  return initialized;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/garmin/instant.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Update exports**

Add to `src/garmin/index.ts`:

```typescript
export * from "./instant";
```

**Step 6: Commit**

```bash
git add src/garmin/instant.ts src/garmin/instant.test.ts src/garmin/index.ts
git commit -m "$(cat <<'EOF'
feat: add instant Garmin API client using garmin-connect

Provides real-time access to vitals, activities, and sleep data
without requiring full GarminDB sync.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create Instant Garmin Tools for Gemini

**Files:**
- Create: `src/tools/instant-garmin.ts`
- Modify: `src/tools/index.ts`

**Step 1: Write the failing test**

Create `src/tools/instant-garmin.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { toolRegistry } from "./registry";

// Mock the instant module
mock.module("../garmin/instant", () => ({
  getCurrentVitals: mock(() =>
    Promise.resolve({
      steps: 10000,
      restingHr: 58,
      stressLevel: 30,
      bodyBatteryHigh: 85,
      bodyBatteryLow: 40,
    })
  ),
  getLatestActivities: mock(() =>
    Promise.resolve([
      {
        activityId: 1,
        activityName: "Morning Run",
        activityType: "running",
        startTimeLocal: "2026-02-03T07:00:00",
        distance: 5000,
        duration: 1800,
        averageHR: 155,
      },
    ])
  ),
  getTodaysSleep: mock(() =>
    Promise.resolve({
      totalSleep: 28800,
      deepSleep: 7200,
      lightSleep: 16200,
      remSleep: 5400,
      score: 85,
    })
  ),
}));

// Import tools after mocking
await import("./instant-garmin");

describe("Instant Garmin Tools", () => {
  test("get_current_vitals tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_current_vitals");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("real-time");
  });

  test("get_latest_activities tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_latest_activities");
    expect(tool).toBeDefined();
  });

  test("get_todays_sleep tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_todays_sleep_instant");
    expect(tool).toBeDefined();
  });

  test("get_current_vitals executes correctly", async () => {
    const result = await toolRegistry.execute({
      name: "get_current_vitals",
      args: {},
    });
    expect(result.result).toEqual({
      steps: 10000,
      restingHr: 58,
      stressLevel: 30,
      bodyBatteryHigh: 85,
      bodyBatteryLow: 40,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/tools/instant-garmin.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/tools/instant-garmin.ts`:

```typescript
import { toolRegistry } from "./registry";
import {
  getCurrentVitals,
  getLatestActivities,
  getTodaysSleep,
} from "../garmin/instant";

// Tool: get_current_vitals
toolRegistry.register(
  {
    name: "get_current_vitals",
    description:
      "Get real-time vitals from Garmin (steps, HR, stress, body battery). " +
      "Use this for current state queries - always fresh, no sync needed.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    return await getCurrentVitals();
  }
);

// Tool: get_latest_activities
toolRegistry.register(
  {
    name: "get_latest_activities",
    description:
      "Get recent activities directly from Garmin API. " +
      "Use this for activities that happened since last SQLite sync, " +
      "especially if sync was >1 hour ago.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of activities to fetch (default: 10, max: 50)",
        },
      },
    },
  },
  async (args: { limit?: number }) => {
    const limit = Math.min(args.limit ?? 10, 50);
    return await getLatestActivities(limit);
  }
);

// Tool: get_todays_sleep_instant
toolRegistry.register(
  {
    name: "get_todays_sleep_instant",
    description:
      "Get last night's sleep data directly from Garmin API. " +
      "Use this for sleep queries before SQLite has synced today's data.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    const sleep = await getTodaysSleep();
    if (!sleep) {
      return { error: "No sleep data available for today" };
    }
    return {
      totalSleepMinutes: Math.round(sleep.totalSleep / 60),
      deepSleepMinutes: Math.round(sleep.deepSleep / 60),
      lightSleepMinutes: Math.round(sleep.lightSleep / 60),
      remSleepMinutes: Math.round(sleep.remSleep / 60),
      score: sleep.score,
    };
  }
);
```

**Step 4: Run test to verify it passes**

Run: `bun test src/tools/instant-garmin.test.ts`
Expected: PASS

**Step 5: Update exports**

Add to `src/tools/index.ts`:

```typescript
import "./instant-garmin";
```

**Step 6: Commit**

```bash
git add src/tools/instant-garmin.ts src/tools/instant-garmin.test.ts src/tools/index.ts
git commit -m "$(cat <<'EOF'
feat: add instant Garmin tools for Gemini

- get_current_vitals: real-time steps, HR, stress, body battery
- get_latest_activities: recent activities from API
- get_todays_sleep_instant: last night's sleep data

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create Chat Log Persistence

**Files:**
- Create: `src/chats/store.ts`
- Create: `src/chats/index.ts`

**Step 1: Write the failing test**

Create `src/chats/store.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "chats-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// We need to mock config before importing store
import { mock } from "bun:test";

describe("Chat Store", () => {
  test("appendChat creates directory and file if not exists", async () => {
    // Mock config to use test directory
    mock.module("../config", () => ({
      chatsPath: testDir,
      timezone: "UTC",
    }));

    const { appendChat, getChatsForDate } = await import("./store");

    await appendChat("Hello", "Hi there!", new Date("2026-02-03T14:30:00Z"));

    const chats = await getChatsForDate("2026-02-03");
    expect(chats).toHaveLength(1);
    expect(chats[0].user).toBe("Hello");
    expect(chats[0].assistant).toBe("Hi there!");
  });

  test("appendChat appends to existing file", async () => {
    mock.module("../config", () => ({
      chatsPath: testDir,
      timezone: "UTC",
    }));

    const { appendChat, getChatsForDate } = await import("./store");

    await appendChat("First", "First reply", new Date("2026-02-03T10:00:00Z"));
    await appendChat("Second", "Second reply", new Date("2026-02-03T11:00:00Z"));

    const chats = await getChatsForDate("2026-02-03");
    expect(chats).toHaveLength(2);
  });

  test("getChatsForDate returns empty array for missing date", async () => {
    mock.module("../config", () => ({
      chatsPath: testDir,
      timezone: "UTC",
    }));

    const { getChatsForDate } = await import("./store");

    const chats = await getChatsForDate("2026-01-01");
    expect(chats).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/chats/store.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/chats/store.ts`:

```typescript
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import * as config from "../config";

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

  const file = Bun.file(filePath);
  const line = JSON.stringify(entry) + "\n";

  if (await file.exists()) {
    // Append to existing file
    const existing = await file.text();
    await Bun.write(filePath, existing + line);
  } else {
    // Create new file
    await Bun.write(filePath, line);
  }
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
```

Create `src/chats/index.ts`:

```typescript
export * from "./store";
```

**Step 4: Run test to verify it passes**

Run: `bun test src/chats/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/chats/store.ts src/chats/store.test.ts src/chats/index.ts
git commit -m "$(cat <<'EOF'
feat: add chat log persistence for daily summaries

Stores chat exchanges as JSONL files by date for inclusion
in daily summary generation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Create Garmin Sync Scheduler

**Files:**
- Create: `src/garmin/scheduler.ts`
- Modify: `src/garmin/index.ts`

**Step 1: Write the failing test**

Create `src/garmin/scheduler.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock config
mock.module("../config", () => ({
  garminSyncIntervalHours: 4,
  summaryHour: 0, // midnight
  timezone: "UTC",
}));

// Mock sync module
const mockSyncGarmin = mock(() => Promise.resolve());
mock.module("./sync", () => ({
  syncGarmin: mockSyncGarmin,
  getLastSyncTime: () => new Date(Date.now() - 3600000), // 1 hour ago
}));

const { shouldSkipScheduledSync, getNextSyncTime, runScheduledSync } = await import(
  "./scheduler"
);

describe("Garmin Scheduler", () => {
  beforeEach(() => {
    mockSyncGarmin.mockClear();
  });

  test("shouldSkipScheduledSync returns true when EOD is within 1 hour", () => {
    // Mock current time to 23:30 (30 min before midnight)
    const now = new Date("2026-02-03T23:30:00Z");
    expect(shouldSkipScheduledSync(now)).toBe(true);
  });

  test("shouldSkipScheduledSync returns false when EOD is >1 hour away", () => {
    // Mock current time to 20:00 (4 hours before midnight)
    const now = new Date("2026-02-03T20:00:00Z");
    expect(shouldSkipScheduledSync(now)).toBe(false);
  });

  test("getNextSyncTime returns time 4 hours from now", () => {
    const now = new Date("2026-02-03T10:00:00Z");
    const next = getNextSyncTime(now);
    expect(next.getTime() - now.getTime()).toBe(4 * 60 * 60 * 1000);
  });

  test("runScheduledSync calls syncGarmin when not skipping", async () => {
    const now = new Date("2026-02-03T10:00:00Z");
    await runScheduledSync(now);
    expect(mockSyncGarmin).toHaveBeenCalledTimes(1);
  });

  test("runScheduledSync skips sync near EOD", async () => {
    const now = new Date("2026-02-03T23:30:00Z");
    await runScheduledSync(now);
    expect(mockSyncGarmin).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/garmin/scheduler.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/garmin/scheduler.ts`:

```typescript
import * as config from "../config";
import { syncGarmin, getLastSyncTime } from "./sync";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastScheduledSyncTime: Date | null = null;

export function getHourInTimezone(date: Date, tz: string): number {
  return parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }),
    10
  );
}

export function getMinutesToEod(date: Date, summaryHour: number, tz: string): number {
  const currentHour = getHourInTimezone(date, tz);
  const currentMinute = parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      minute: "2-digit",
    }),
    10
  );

  let hoursToEod: number;
  if (currentHour >= summaryHour) {
    // EOD is tomorrow
    hoursToEod = 24 - currentHour + summaryHour;
  } else {
    // EOD is today
    hoursToEod = summaryHour - currentHour;
  }

  return hoursToEod * 60 - currentMinute;
}

export function shouldSkipScheduledSync(now: Date = new Date()): boolean {
  const minutesToEod = getMinutesToEod(now, config.summaryHour, config.timezone);
  // Skip if EOD is within 60 minutes
  return minutesToEod <= 60;
}

export function getNextSyncTime(now: Date = new Date()): Date {
  const intervalMs = config.garminSyncIntervalHours * 60 * 60 * 1000;
  return new Date(now.getTime() + intervalMs);
}

export async function runScheduledSync(now: Date = new Date()): Promise<void> {
  if (shouldSkipScheduledSync(now)) {
    console.log(
      "[Scheduler] Skipping scheduled sync - EOD summary within 1 hour"
    );
    return;
  }

  console.log("[Scheduler] Running scheduled Garmin sync");
  try {
    await syncGarmin();
    lastScheduledSyncTime = new Date();
    console.log("[Scheduler] Scheduled sync completed");
  } catch (error) {
    console.error("[Scheduler] Scheduled sync failed:", error);
  }
}

export function startSyncScheduler(): void {
  if (schedulerInterval) {
    console.log("[Scheduler] Sync scheduler already running");
    return;
  }

  const intervalMs = config.garminSyncIntervalHours * 60 * 60 * 1000;

  console.log(
    `[Scheduler] Starting sync scheduler (every ${config.garminSyncIntervalHours} hours)`
  );

  schedulerInterval = setInterval(() => {
    runScheduledSync();
  }, intervalMs);

  // Log next scheduled sync time
  const nextSync = getNextSyncTime();
  console.log(`[Scheduler] Next scheduled sync at ${nextSync.toISOString()}`);
}

export function stopSyncScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Sync scheduler stopped");
  }
}

export function getLastScheduledSyncTime(): Date | null {
  return lastScheduledSyncTime;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/garmin/scheduler.test.ts`
Expected: PASS

**Step 5: Update exports**

Add to `src/garmin/index.ts`:

```typescript
export * from "./scheduler";
```

**Step 6: Commit**

```bash
git add src/garmin/scheduler.ts src/garmin/scheduler.test.ts src/garmin/index.ts
git commit -m "$(cat <<'EOF'
feat: add scheduled Garmin sync with EOD coordination

Syncs every 4 hours by default, skips if EOD summary
generation is within 1 hour to avoid redundant syncs.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Create Daily Summary Generator

**Files:**
- Create: `src/summaries/generator.ts`
- Create: `src/summaries/index.ts`

**Step 1: Write the failing test**

Create `src/summaries/generator.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "summaries-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// Mock dependencies
mock.module("../config", () => ({
  summariesPath: testDir,
  timezone: "UTC",
}));

mock.module("../garmin/queries", () => ({
  getTodaysSummary: () => ({
    date: "2026-02-03",
    steps: 12000,
    rhr: 55,
    stress_avg: 28,
    bb_max: 85,
    bb_min: 35,
    sleep_score: 82,
  }),
  getRecentActivities: () => [
    {
      activity_id: 1,
      name: "Morning Run",
      type: "running",
      distance: 5200,
      elapsed_time: 1800,
      avg_hr: 155,
      max_hr: 175,
    },
  ],
  getSleepTrend: () => [
    {
      date: "2026-02-03",
      total_sleep: 25920,
      deep_sleep: 6480,
      light_sleep: 14400,
      rem_sleep: 5040,
      score: 82,
    },
  ],
}));

mock.module("../chats/store", () => ({
  getChatsForDate: () => [
    { time: "10:30", user: "How was my run?", assistant: "Great pace!" },
  ],
}));

mock.module("../agent/gemini", () => ({
  chat: () =>
    Promise.resolve({
      text: "# Daily Summary\n\nGreat day!",
      toolCalls: [],
      finishReason: "STOP",
    }),
}));

mock.module("../memory/client", () => ({
  saveInsight: () => Promise.resolve({ id: "123" }),
}));

const { generateDailySummary, getSummaryFilePath } = await import("./generator");

describe("Daily Summary Generator", () => {
  test("getSummaryFilePath returns correct path", () => {
    const path = getSummaryFilePath("2026-02-03");
    expect(path).toBe(join(testDir, "2026-02-03.md"));
  });

  test("generateDailySummary creates markdown file", async () => {
    await generateDailySummary("2026-02-03");

    const file = Bun.file(join(testDir, "2026-02-03.md"));
    expect(await file.exists()).toBe(true);

    const content = await file.text();
    expect(content).toContain("Daily Summary");
  });

  test("generateDailySummary is idempotent", async () => {
    await generateDailySummary("2026-02-03");
    const firstContent = await Bun.file(join(testDir, "2026-02-03.md")).text();

    // Modify mock to return different content
    mock.module("../agent/gemini", () => ({
      chat: () =>
        Promise.resolve({
          text: "# Different content",
          toolCalls: [],
          finishReason: "STOP",
        }),
    }));

    // Re-generate should not overwrite
    await generateDailySummary("2026-02-03", { overwrite: false });
    const secondContent = await Bun.file(join(testDir, "2026-02-03.md")).text();

    expect(secondContent).toBe(firstContent);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/summaries/generator.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/summaries/generator.ts`:

```typescript
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import * as config from "../config";
import { getTodaysSummary, getRecentActivities, getSleepTrend } from "../garmin/queries";
import { getChatsForDate, ChatEntry } from "../chats/store";
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

  // Gather data
  const [vitals, activities, sleep, chats] = await Promise.all([
    getTodaysSummary(),
    getRecentActivities(1), // Just today's activities
    getSleepTrend(1), // Just last night's sleep
    getChatsForDate(dateStr),
  ]);

  // Build data context for LLM
  const dataContext = buildDataContext(dateStr, vitals, activities, sleep, chats);

  // Generate summary with Gemini
  const response = await chat(
    [{ role: "user", parts: [{ text: dataContext }] }],
    [], // No tools needed for generation
    SUMMARY_GENERATION_PROMPT
  );

  const summaryContent = response.text;

  // Ensure directory exists and write file
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, summaryContent);

  // Save to Mem0
  try {
    await saveInsight(
      `Daily summary for ${dateStr}:\n${summaryContent}`,
      "weekly_summaries" // Reuse existing category
    );
    console.log(`[Summary] Saved ${dateStr} summary to Mem0`);
  } catch (error) {
    console.error(`[Summary] Failed to save to Mem0:`, error);
  }

  console.log(`[Summary] Generated summary for ${dateStr}`);
  return summaryContent;
}

function buildDataContext(
  dateStr: string,
  vitals: any,
  activities: any[],
  sleep: any[],
  chats: ChatEntry[]
): string {
  const sections: string[] = [`Date: ${dateStr}`, ""];

  // Vitals
  if (vitals) {
    sections.push("VITALS DATA:");
    sections.push(`- Steps: ${vitals.steps ?? "N/A"}`);
    sections.push(`- Resting HR: ${vitals.rhr ?? "N/A"} bpm`);
    sections.push(`- Stress avg: ${vitals.stress_avg ?? "N/A"}`);
    sections.push(`- Body Battery: ${vitals.bb_min ?? "N/A"} → ${vitals.bb_max ?? "N/A"}`);
    sections.push(`- Sleep Score: ${vitals.sleep_score ?? "N/A"}`);
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
        `- ${act.name} (${act.type}): ${formatDistance(act.distance)}, ` +
          `${formatDuration(act.elapsed_time)}, avg HR ${act.avg_hr ?? "N/A"}, ` +
          `max HR ${act.max_hr ?? "N/A"}`
      );
    }
  } else {
    sections.push("No recorded activities");
  }
  sections.push("");

  // Sleep
  sections.push("SLEEP (previous night):");
  if (sleep.length > 0) {
    const s = sleep[0];
    sections.push(`- Total: ${formatDuration(s.total_sleep)}`);
    sections.push(`- Deep: ${formatDuration(s.deep_sleep)}`);
    sections.push(`- Light: ${formatDuration(s.light_sleep)}`);
    sections.push(`- REM: ${formatDuration(s.rem_sleep)}`);
    sections.push(`- Score: ${s.score ?? "N/A"}`);
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

function formatDistance(meters: number | null): string {
  if (!meters) return "N/A";
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "N/A";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
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
```

Create `src/summaries/index.ts`:

```typescript
export * from "./generator";
```

**Step 4: Run test to verify it passes**

Run: `bun test src/summaries/generator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/summaries/generator.ts src/summaries/generator.test.ts src/summaries/index.ts
git commit -m "$(cat <<'EOF'
feat: add daily summary generator with Gemini

Combines Garmin data and chat logs into structured
markdown summaries, saved to Mem0 for semantic search.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Create Summary Backfill Process

**Files:**
- Create: `src/summaries/backfill.ts`
- Modify: `src/summaries/index.ts`

**Step 1: Write the failing test**

Create `src/summaries/backfill.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "backfill-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// Mock config
mock.module("../config", () => ({
  summariesPath: testDir,
  timezone: "UTC",
}));

// Mock generator
const mockGenerateSummary = mock(() => Promise.resolve("# Summary"));
mock.module("./generator", () => ({
  generateDailySummary: mockGenerateSummary,
  summaryExists: async (date: string) => {
    const file = Bun.file(join(testDir, `${date}.md`));
    return await file.exists();
  },
}));

const { getMissingDates, runBackfill } = await import("./backfill");

describe("Summary Backfill", () => {
  beforeEach(() => {
    mockGenerateSummary.mockClear();
  });

  test("getMissingDates returns dates without summaries", async () => {
    // Create one existing summary
    await Bun.write(join(testDir, "2026-02-01.md"), "# Existing");

    const missing = await getMissingDates(
      new Date("2026-02-01"),
      new Date("2026-02-03")
    );

    expect(missing).toEqual(["2026-02-02", "2026-02-03"]);
  });

  test("runBackfill generates missing summaries", async () => {
    await runBackfill(new Date("2026-02-01"), new Date("2026-02-02"));

    expect(mockGenerateSummary).toHaveBeenCalledTimes(2);
  });

  test("runBackfill skips existing summaries", async () => {
    await Bun.write(join(testDir, "2026-02-01.md"), "# Existing");

    await runBackfill(new Date("2026-02-01"), new Date("2026-02-02"));

    // Should only generate for 2026-02-02
    expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
    expect(mockGenerateSummary).toHaveBeenCalledWith("2026-02-02");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/summaries/backfill.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/summaries/backfill.ts`:

```typescript
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
  const missingDates = await getMissingDates(startDate, endDate);

  backfillProgress = {
    total: missingDates.length,
    completed: 0,
    current: null,
    errors: [],
  };

  if (missingDates.length === 0) {
    console.log("[Backfill] No missing summaries to generate");
    backfillRunning = false;
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
    if (backfillProgress.completed < missingDates.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  backfillProgress.current = null;
  backfillRunning = false;

  console.log(
    `[Backfill] Complete: ${backfillProgress.completed}/${backfillProgress.total}, ` +
      `${backfillProgress.errors.length} errors`
  );

  return backfillProgress;
}

export function getBackfillProgress(): BackfillProgress | null {
  return backfillProgress;
}

export function isBackfillRunning(): boolean {
  return backfillRunning;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/summaries/backfill.test.ts`
Expected: PASS

**Step 5: Update exports**

Add to `src/summaries/index.ts`:

```typescript
export * from "./backfill";
```

**Step 6: Commit**

```bash
git add src/summaries/backfill.ts src/summaries/backfill.test.ts src/summaries/index.ts
git commit -m "$(cat <<'EOF'
feat: add daily summary backfill for historical data

Idempotently generates missing summaries from GARMIN_START_DATE
with progress tracking and rate limit handling.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Create EOD Summary Scheduler

**Files:**
- Create: `src/summaries/scheduler.ts`
- Modify: `src/summaries/index.ts`

**Step 1: Write the failing test**

Create `src/summaries/scheduler.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock config
mock.module("../config", () => ({
  summaryHour: 0,
  timezone: "UTC",
}));

// Mock sync
const mockSyncGarmin = mock(() => Promise.resolve());
mock.module("../garmin/sync", () => ({
  syncGarmin: mockSyncGarmin,
}));

// Mock generator
const mockGenerateSummary = mock(() => Promise.resolve("# Summary"));
mock.module("./generator", () => ({
  generateDailySummary: mockGenerateSummary,
}));

const { getMillisecondsToNextSummary, runEodSummary } = await import(
  "./scheduler"
);

describe("Summary Scheduler", () => {
  beforeEach(() => {
    mockSyncGarmin.mockClear();
    mockGenerateSummary.mockClear();
  });

  test("getMillisecondsToNextSummary calculates correctly", () => {
    // At 22:00, next summary at 00:00 = 2 hours
    const now = new Date("2026-02-03T22:00:00Z");
    const ms = getMillisecondsToNextSummary(now);
    expect(ms).toBe(2 * 60 * 60 * 1000);
  });

  test("getMillisecondsToNextSummary handles past summary hour", () => {
    // At 01:00, next summary at 00:00 tomorrow = 23 hours
    const now = new Date("2026-02-03T01:00:00Z");
    const ms = getMillisecondsToNextSummary(now);
    expect(ms).toBe(23 * 60 * 60 * 1000);
  });

  test("runEodSummary syncs then generates summary", async () => {
    await runEodSummary();

    // Verify sync was called first
    expect(mockSyncGarmin).toHaveBeenCalledTimes(1);

    // Verify summary was generated for yesterday
    expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/summaries/scheduler.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/summaries/scheduler.ts`:

```typescript
import * as config from "../config";
import { syncGarmin } from "../garmin/sync";
import { generateDailySummary } from "./generator";

let summaryTimeout: ReturnType<typeof setTimeout> | null = null;

function getHourInTimezone(date: Date, tz: string): number {
  return parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }),
    10
  );
}

function getMinuteInTimezone(date: Date, tz: string): number {
  return parseInt(
    date.toLocaleTimeString("en-GB", {
      timeZone: tz,
      minute: "2-digit",
    }),
    10
  );
}

export function getMillisecondsToNextSummary(now: Date = new Date()): number {
  const currentHour = getHourInTimezone(now, config.timezone);
  const currentMinute = getMinuteInTimezone(now, config.timezone);

  let hoursUntilSummary: number;
  if (currentHour >= config.summaryHour) {
    // Summary hour has passed today, schedule for tomorrow
    hoursUntilSummary = 24 - currentHour + config.summaryHour;
  } else {
    // Summary hour is later today
    hoursUntilSummary = config.summaryHour - currentHour;
  }

  // Convert to milliseconds, accounting for current minute
  const minutesUntilSummary = hoursUntilSummary * 60 - currentMinute;
  return minutesUntilSummary * 60 * 1000;
}

function getYesterdayDateStr(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split("T")[0];
}

export async function runEodSummary(): Promise<void> {
  console.log("[EOD] Starting end-of-day summary generation");

  // Force sync before generating summary
  console.log("[EOD] Running forced Garmin sync");
  try {
    await syncGarmin();
    console.log("[EOD] Garmin sync completed");
  } catch (error) {
    console.error("[EOD] Garmin sync failed, continuing with summary:", error);
  }

  // Generate summary for yesterday
  const yesterdayStr = getYesterdayDateStr();
  console.log(`[EOD] Generating summary for ${yesterdayStr}`);

  try {
    await generateDailySummary(yesterdayStr, { overwrite: true });
    console.log(`[EOD] Summary generated for ${yesterdayStr}`);
  } catch (error) {
    console.error(`[EOD] Failed to generate summary:`, error);
  }

  // Schedule next run
  scheduleNextSummary();
}

function scheduleNextSummary(): void {
  const msToNext = getMillisecondsToNextSummary();
  const nextTime = new Date(Date.now() + msToNext);

  console.log(`[EOD] Next summary scheduled for ${nextTime.toISOString()}`);

  summaryTimeout = setTimeout(() => {
    runEodSummary();
  }, msToNext);
}

export function startSummaryScheduler(): void {
  if (summaryTimeout) {
    console.log("[EOD] Summary scheduler already running");
    return;
  }

  console.log(
    `[EOD] Starting summary scheduler (daily at ${config.summaryHour}:00 ${config.timezone})`
  );
  scheduleNextSummary();
}

export function stopSummaryScheduler(): void {
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
    console.log("[EOD] Summary scheduler stopped");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/summaries/scheduler.test.ts`
Expected: PASS

**Step 5: Update exports**

Add to `src/summaries/index.ts`:

```typescript
export * from "./scheduler";
```

**Step 6: Commit**

```bash
git add src/summaries/scheduler.ts src/summaries/scheduler.test.ts src/summaries/index.ts
git commit -m "$(cat <<'EOF'
feat: add EOD summary scheduler with forced sync

Runs daily at configured hour, forces Garmin sync before
generating yesterday's summary.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Create Daily Summary Tool

**Files:**
- Create: `src/tools/summaries.ts`
- Modify: `src/tools/index.ts`

**Step 1: Write the failing test**

Create `src/tools/summaries.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { toolRegistry } from "./registry";

// Mock summary module
mock.module("../summaries/generator", () => ({
  getSummary: (date: string) => {
    if (date === "2026-02-03") {
      return Promise.resolve("# Daily Summary - 2026-02-03\n\nGreat day!");
    }
    return Promise.resolve(null);
  },
}));

// Import tool registration
await import("./summaries");

describe("Summary Tools", () => {
  test("get_daily_summary tool is registered", () => {
    const defs = toolRegistry.getDefinitions();
    const tool = defs.find((t) => t.name === "get_daily_summary");
    expect(tool).toBeDefined();
    expect(tool?.parameters.properties.date).toBeDefined();
  });

  test("get_daily_summary returns summary for valid date", async () => {
    const result = await toolRegistry.execute({
      name: "get_daily_summary",
      args: { date: "2026-02-03" },
    });
    expect(result.result).toContain("Great day!");
  });

  test("get_daily_summary returns error for missing date", async () => {
    const result = await toolRegistry.execute({
      name: "get_daily_summary",
      args: { date: "2020-01-01" },
    });
    expect(result.result).toEqual({ error: "No summary found for 2020-01-01" });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/tools/summaries.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

Create `src/tools/summaries.ts`:

```typescript
import { toolRegistry } from "./registry";
import { getSummary } from "../summaries/generator";

// Tool: get_daily_summary
toolRegistry.register(
  {
    name: "get_daily_summary",
    description:
      "Get the daily summary for a specific date. " +
      "Returns a markdown document with activities, vitals, sleep, " +
      "and chat interactions from that day. " +
      "Use for reviewing past days or answering 'what happened on X date'.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (e.g., 2026-02-03)",
        },
      },
      required: ["date"],
    },
  },
  async (args: { date: string }) => {
    const summary = await getSummary(args.date);

    if (!summary) {
      return { error: `No summary found for ${args.date}` };
    }

    return summary;
  }
);
```

**Step 4: Run test to verify it passes**

Run: `bun test src/tools/summaries.test.ts`
Expected: PASS

**Step 5: Update exports**

Add to `src/tools/index.ts`:

```typescript
import "./summaries";
```

**Step 6: Commit**

```bash
git add src/tools/summaries.ts src/tools/summaries.test.ts src/tools/index.ts
git commit -m "$(cat <<'EOF'
feat: add get_daily_summary tool for Gemini

Enables querying daily summaries by date for historical
context and day review.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update System Prompts with Dynamic Context

**Files:**
- Modify: `src/prompts.ts:1-39`

**Step 1: Write the failing test**

Create `src/prompts.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { buildMainPrompt, PromptContext } from "./prompts";

describe("Dynamic Prompts", () => {
  test("buildMainPrompt includes sync time", () => {
    const context: PromptContext = {
      lastSyncTime: new Date("2026-02-03T10:00:00Z"),
      lastSyncAgo: "2 hours ago",
      messageTime: new Date("2026-02-03T12:00:00Z"),
      messageTimeLocal: "12:00",
    };

    const prompt = buildMainPrompt(context);

    expect(prompt).toContain("2 hours ago");
    expect(prompt).toContain("12:00");
  });

  test("buildMainPrompt includes data freshness guidance", () => {
    const context: PromptContext = {
      lastSyncTime: new Date("2026-02-03T10:00:00Z"),
      lastSyncAgo: "2 hours ago",
      messageTime: new Date("2026-02-03T12:00:00Z"),
      messageTimeLocal: "12:00",
    };

    const prompt = buildMainPrompt(context);

    expect(prompt).toContain("SQLite Data");
    expect(prompt).toContain("Instant API");
    expect(prompt).toContain("Daily Summaries");
  });

  test("buildMainPrompt includes rule of thumb", () => {
    const context: PromptContext = {
      lastSyncTime: new Date("2026-02-03T10:00:00Z"),
      lastSyncAgo: "5 hours ago",
      messageTime: new Date("2026-02-03T15:00:00Z"),
      messageTimeLocal: "15:00",
    };

    const prompt = buildMainPrompt(context);

    expect(prompt).toContain("prefer instant API");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/prompts.test.ts`
Expected: FAIL - buildMainPrompt not exported

**Step 3: Update implementation**

Modify `src/prompts.ts` to add dynamic prompt builder:

```typescript
export const BOOTSTRAP_PROMPT = `You are Kettl, a supportive health coaching assistant focused on Garmin fitness data.

This is your first conversation with this user. Your goal is to understand who they are and what they're looking for in a health coach.

Explore:
- What are their main health/fitness goals?
- Any specific targets or timelines?
- What kind of coaching style do they prefer? (data-driven, motivational, gentle reminders, etc.)
- Any constraints or limitations to be aware of?
- Past experiences with fitness tracking or coaching?

Save important information about the user with the \`save_insight\` tool using category "user_profile".

Be conversational and warm. Build rapport while gathering useful context.`;

const MAIN_PROMPT_BASE = `You are Kettl, a supportive health coaching assistant focused on Garmin fitness data.

Your core approach:
- Reference actual data when making observations
- Be concise but warm - no walls of text
- Celebrate wins, gently note areas for improvement
- Connect the dots between sleep, stress, activity, and recovery

Tool guidance:
- Use \`search_memories\` to recall past discussions, goals, and patterns
- Save insights when you notice patterns worth remembering
- The sync tools run automatically - only use \`sync_garmin\` if the user just finished a workout and wants immediate data`;

export interface PromptContext {
  lastSyncTime: Date;
  lastSyncAgo: string;
  messageTime: Date;
  messageTimeLocal: string;
}

export function buildMainPrompt(context: PromptContext): string {
  return `${MAIN_PROMPT_BASE}

## Current Context

**Message received:** ${context.messageTimeLocal} (${context.messageTime.toISOString()})
**SQLite last synced:** ${context.lastSyncAgo}

## Data Freshness

**SQLite Data (GarminDB):** Last synced ${context.lastSyncAgo} (${context.lastSyncTime.toISOString()})
- Use for: trends, historical analysis, aggregates, detailed activity breakdowns
- Tools: get_todays_summary, get_recent_activities, get_sleep_trend, get_weight_trend, get_body_battery_trend, query_garmin

**Instant API:** Real-time, always fresh
- Use for: anything that happened since last sync, current state
- Tools: get_current_vitals, get_latest_activities, get_todays_sleep_instant

**Daily Summaries:** Structured archive of each day
- Use for: "what happened on X date", reviewing past days
- Tool: get_daily_summary

**Rule of thumb:** If the user asks about "now" or "today" and sync was >1 hour ago, prefer instant API tools.`;
}

// Keep MAIN_PROMPT for backwards compatibility during migration
export const MAIN_PROMPT = MAIN_PROMPT_BASE;
```

**Step 4: Run test to verify it passes**

Run: `bun test src/prompts.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/prompts.ts src/prompts.test.ts
git commit -m "$(cat <<'EOF'
feat: add dynamic system prompt with data freshness context

Injects sync time, message time, and data tier guidance
to help Gemini choose appropriate tools.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Update Telegram Bot with New Features

**Files:**
- Modify: `src/telegram/bot.ts:1-173`

**Step 1: Identify changes needed**

The bot needs:
1. Remove per-message sync (replaced by scheduler)
2. Add chat log persistence
3. Build dynamic prompt with sync context
4. Initialize instant client on startup

**Step 2: Update the bot implementation**

Modify `src/telegram/bot.ts`:

```typescript
import { Bot, Context } from "grammy";
import * as config from "../config";
import { runAgent } from "../agent";
import {
  isBackgroundSyncRunning,
  getSyncProgress,
  getLastSyncTime,
} from "../garmin/sync";
import { initInstantClient } from "../garmin/instant";
import { isMemoryAvailable, getUserProfile } from "../memory/client";
import { BOOTSTRAP_PROMPT, buildMainPrompt, PromptContext } from "../prompts";
import { withTimeout, TimeoutError } from "../utils";
import { appendChat } from "../chats/store";

const bot = new Bot(config.telegramBotToken());

function startTypingIndicator(ctx: Context): () => void {
  const interval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);

  return () => clearInterval(interval);
}

function formatTimeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours > 1 ? "s" : ""} ago`;
}

function getMessageTimeLocal(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    timeZone: config.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function createBot(): Bot {
  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const messageTime = new Date();
    const warnings: string[] = [];

    // If first sync still running, give status
    if (isBackgroundSyncRunning()) {
      const progress = getSyncProgress();
      let statusMsg = "🔄 Still syncing your Garmin data...";

      if (progress) {
        const { phase, percent, startTime } = progress;
        if (percent) {
          // Parse progress format: "5% (200/4052) - 02:30<45:00"
          const etaMatch = percent.match(
            /(\d+)%\s*\([^)]+\)\s*-\s*[\d:]+<([\d:]+)/
          );
          if (etaMatch) {
            statusMsg = `🔄 ${phase}: ${etaMatch[1]}% complete, ~${etaMatch[2]} remaining`;
          } else {
            statusMsg = `🔄 ${phase}: ${percent}`;
          }
        } else {
          statusMsg = `🔄 ${phase}...`;
        }
      }

      await ctx.reply(statusMsg);
      return;
    }

    const stopTyping = startTypingIndicator(ctx);

    try {
      // No per-message sync - scheduler handles it
      // Just note if data might be stale
      const lastSync = getLastSyncTime();
      const syncAge = lastSync
        ? Date.now() - lastSync.getTime()
        : Infinity;
      const syncAgeHours = syncAge / (1000 * 60 * 60);

      if (syncAgeHours > 4) {
        warnings.push(
          `⚠️ SQLite data is ${Math.floor(syncAgeHours)} hours old. Using instant API for recent data.`
        );
      }

      // Check memory availability
      const memoryAvailable = await isMemoryAvailable();
      if (!memoryAvailable) {
        warnings.push("⚠️ Memory service unavailable");
      }

      // Determine prompt based on user profile
      let systemPrompt: string;
      if (memoryAvailable) {
        const profile = await getUserProfile();
        if (profile.hasProfile) {
          // Build dynamic prompt with context
          const context: PromptContext = {
            lastSyncTime: lastSync ?? new Date(0),
            lastSyncAgo: lastSync ? formatTimeSince(lastSync) : "never",
            messageTime,
            messageTimeLocal: getMessageTimeLocal(messageTime),
          };
          systemPrompt = buildMainPrompt(context);
        } else {
          systemPrompt = BOOTSTRAP_PROMPT;
        }
      } else {
        systemPrompt = BOOTSTRAP_PROMPT;
      }

      // Run agent with timeout
      const response = await withTimeout(
        runAgent(userMessage, systemPrompt),
        config.overallTimeout
      );

      // Persist chat for daily summaries
      try {
        await appendChat(userMessage, response.text, messageTime);
      } catch (chatError) {
        console.error("[Bot] Failed to persist chat:", chatError);
      }

      // Build final response
      let finalResponse = response.text;
      if (warnings.length > 0) {
        finalResponse = warnings.join("\n") + "\n\n" + finalResponse;
      }

      await ctx.reply(finalResponse, { parse_mode: "Markdown" });
    } catch (error) {
      stopTyping();

      if (error instanceof TimeoutError) {
        await ctx.reply(
          "⏰ Sorry, that took too long. Please try again with a simpler question."
        );
      } else {
        console.error("[Bot] Error:", error);
        await ctx.reply(
          "❌ Something went wrong. Please try again."
        );
      }
    } finally {
      stopTyping();
    }
  });

  return bot;
}

export async function startBot(): Promise<void> {
  // Initialize instant client
  try {
    await initInstantClient();
  } catch (error) {
    console.error("[Bot] Failed to initialize instant client:", error);
  }

  await bot.start();
}
```

**Step 3: Run existing tests**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/telegram/bot.ts
git commit -m "$(cat <<'EOF'
feat: update bot with chat persistence and dynamic prompts

- Remove per-message sync (handled by scheduler)
- Add chat log persistence for daily summaries
- Build dynamic prompt with sync time context
- Initialize instant client on startup

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update Startup Sequence

**Files:**
- Modify: `src/index.ts:1-19`

**Step 1: Update the startup sequence**

Modify `src/index.ts`:

```typescript
import "./tools";
import { syncGarminBackground } from "./garmin/sync";
import { initInstantClient } from "./garmin/instant";
import { startSyncScheduler } from "./garmin/scheduler";
import { startSummaryScheduler } from "./summaries/scheduler";
import { runBackfill, isBackfillRunning } from "./summaries/backfill";
import { startBot } from "./telegram";
import * as config from "./config";

console.log("Kettl starting...");

async function startup(): Promise<void> {
  // 1. Start initial GarminDB sync (if needed)
  syncGarminBackground();

  // 2. Initialize Garmin Connect API client
  try {
    await initInstantClient();
    console.log("[Startup] Instant Garmin client ready");
  } catch (error) {
    console.error("[Startup] Failed to init instant client:", error);
  }

  // 3. Run backfill for missing daily summaries (in background)
  runBackfillAfterSync();

  // 4. Start 4-hour sync scheduler
  startSyncScheduler();

  // 5. Start EOD summary scheduler
  startSummaryScheduler();

  // 6. Start Telegram bot
  await startBot();
}

async function runBackfillAfterSync(): Promise<void> {
  // Wait for background sync to complete before backfilling
  const checkInterval = setInterval(async () => {
    const { isBackgroundSyncRunning } = await import("./garmin/sync");
    if (!isBackgroundSyncRunning()) {
      clearInterval(checkInterval);

      // Calculate date range
      const startDateStr = process.env.GARMIN_START_DATE;
      if (!startDateStr) {
        console.log("[Startup] No GARMIN_START_DATE set, skipping backfill");
        return;
      }

      const startDate = new Date(startDateStr);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      console.log(
        `[Startup] Running backfill from ${startDateStr} to ${yesterday.toISOString().split("T")[0]}`
      );

      try {
        await runBackfill(startDate, yesterday);
      } catch (error) {
        console.error("[Startup] Backfill failed:", error);
      }
    }
  }, 5000); // Check every 5 seconds
}

startup().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
```

**Step 2: Test startup manually**

Run: `bun run src/index.ts`
Expected: Logs show all components initializing

Press Ctrl+C to stop.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "$(cat <<'EOF'
feat: update startup with schedulers and backfill

1. Initial GarminDB sync
2. Initialize instant Garmin client
3. Run backfill after sync completes
4. Start 4-hour sync scheduler
5. Start EOD summary scheduler
6. Start Telegram bot

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Update Docker Configuration

**Files:**
- Modify: `docker-compose.yml` (if exists)
- Or create: `docker-compose.yml`

**Step 1: Check if docker-compose.yml exists**

Run: `ls -la docker-compose.yml 2>/dev/null || echo "File does not exist"`

**Step 2: Update or create docker-compose.yml**

If file exists, add volumes for new directories. If not, create:

```yaml
version: "3.8"

services:
  kettl:
    build: .
    environment:
      - GARMIN_EMAIL
      - GARMIN_PASSWORD
      - GARMIN_START_DATE
      - GARMIN_ACTIVITY_COUNT
      - GARMINDB_PATH=/app/data/garmindb
      - TELEGRAM_BOT_TOKEN
      - GEMINI_API_KEY
      - MEM0_URL
      - GARMIN_SYNC_INTERVAL_HOURS=4
      - SUMMARY_HOUR=0
      - SUMMARIES_PATH=/app/data/summaries
      - CHATS_PATH=/app/data/chats
      - TZ=Europe/Amsterdam
    volumes:
      - ./data/garmindb:/app/data/garmindb
      - ./data/summaries:/app/data/summaries
      - ./data/chats:/app/data/chats
    restart: unless-stopped
```

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "$(cat <<'EOF'
chore: add docker-compose with new volume mounts

Adds volumes for daily summaries and chat logs.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Run Full Test Suite

**Files:**
- All test files

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Fix any failing tests**

If tests fail, review error messages and fix issues.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: fix test issues from integration

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Update Type Exports

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Export new types**

Add any new types to the central export:

```typescript
export * from "./tools";
export * from "./garmin";
export * from "./memory";
```

**Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "$(cat <<'EOF'
chore: update type exports

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Manual Integration Test

**Steps:**

1. Set environment variables:
   ```bash
   export GARMIN_START_DATE=2026-01-01
   export SUMMARY_HOUR=0
   export TZ=UTC
   ```

2. Start the application:
   ```bash
   bun run src/index.ts
   ```

3. Verify in logs:
   - "Instant Garmin client ready"
   - "Starting sync scheduler (every 4 hours)"
   - "Starting summary scheduler"

4. Send a test message via Telegram

5. Verify:
   - Response includes dynamic context
   - Chat is persisted to `./data/chats/`
   - Instant API tools work

6. Stop the application (Ctrl+C)

---

## Summary

This plan implements the two-tier Garmin data system with:

1. **Config** (Task 1): New env vars for scheduling and paths
2. **Instant API** (Tasks 2-4): garmin-connect client + Gemini tools
3. **Chat Persistence** (Task 5): JSONL storage for daily summaries
4. **Sync Scheduler** (Task 6): 4-hour interval with EOD coordination
5. **Daily Summaries** (Tasks 7-10): Generator, backfill, scheduler, tool
6. **Dynamic Prompts** (Task 11): Sync time and data freshness guidance
7. **Bot Integration** (Task 12): Chat persistence, remove per-message sync
8. **Startup** (Task 13): Initialize all components in order
9. **Docker** (Task 14): Volume mounts for new data
10. **Testing** (Tasks 15-17): Full test suite and manual verification

Total: 17 tasks with TDD approach and frequent commits.
