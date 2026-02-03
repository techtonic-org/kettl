# Kettl Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-hosted health coaching bot that connects Garmin data with Gemini LLM and persistent memory via Telegram.

**Architecture:** Bun TypeScript app with grammY (Telegram), Gemini API (LLM with function calling), GarminDB (SQLite), and Mem0+Qdrant (memory). The bot syncs Garmin data on every message, lets the LLM decide which tools to call, and maintains long-term memory of patterns and goals.

**Tech Stack:** Bun, TypeScript, grammY, @google/generative-ai, bun:sqlite, Mem0, Qdrant, Docker Compose

---

## Phase 1: Data Foundation

### Task 1: Install Bun Runtime

**Files:**
- None (system installation)

**Step 1: Install Bun**

Run:
```bash
curl -fsSL https://bun.sh/install | bash
```

**Step 2: Verify installation**

Run:
```bash
source ~/.bashrc && bun --version
```
Expected: Version number like `1.x.x`

---

### Task 2: Initialize Bun Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Initialize project**

Run:
```bash
cd /home/claude/ttd/kettl && bun init -y
```

**Step 2: Update package.json with dependencies**

Edit `package.json`:
```json
{
  "name": "kettl",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "grammy": "^1.30.0",
    "@google/generative-ai": "^0.21.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

**Step 3: Install dependencies**

Run:
```bash
cd /home/claude/ttd/kettl && bun install
```

**Step 4: Create minimal entry point**

Create `src/index.ts`:
```typescript
console.log("Kettl starting...");
```

**Step 5: Verify project runs**

Run:
```bash
cd /home/claude/ttd/kettl && bun run src/index.ts
```
Expected: `Kettl starting...`

**Step 6: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add package.json bun.lockb tsconfig.json src/index.ts && git commit -m "feat: initialize Bun project with dependencies"
```

---

### Task 3: Install GarminDB

**Files:**
- None (Python package installation)

**Step 1: Install GarminDB via pip**

Run:
```bash
pip install garmindb
```

**Step 2: Verify installation**

Run:
```bash
garmindb_cli.py --help
```
Expected: Help output showing available commands

**Step 3: Create GarminDB config directory**

Run:
```bash
mkdir -p ~/.GarminDb
```

---

### Task 4: Configure Environment Variables

**Files:**
- Create: `.env` (local, not committed)
- Create: `.env.example`
- Update: `.gitignore`

**Step 1: Check if .gitignore exists and update it**

Create/update `.gitignore`:
```
node_modules/
.env
*.db
*.db-journal
```

**Step 2: Create .env.example**

Create `.env.example`:
```
# Garmin Connect credentials
GARMIN_EMAIL=your-email@example.com
GARMIN_PASSWORD=your-password

# Telegram Bot
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# Gemini API
GEMINI_API_KEY=your-gemini-api-key

# Mem0 (when running with Docker)
MEM0_URL=http://localhost:8080

# GarminDB path (where databases are stored)
GARMINDB_PATH=~/.GarminDb/HealthData
```

**Step 3: Commit gitignore and example**

Run:
```bash
cd /home/claude/ttd/kettl && git add .gitignore .env.example && git commit -m "feat: add environment configuration"
```

**Note:** GarminConnectConfig.json is NOT manually created. The app generates it automatically from GARMIN_EMAIL and GARMIN_PASSWORD env vars (see Task 9).

---

### Task 5: Initial Garmin Sync (Automatic)

**SKIPPED** - Sync happens automatically on first app run. The sync wrapper (Task 9) generates the GarminDB config from env vars and runs the sync. No manual setup required.

---

### Task 5 (Original): Run Initial Garmin Sync

**DEPRECATED** - This task is now automatic. Keeping for reference.

Run:
```bash
garmindb_cli.py --all --download --import --analyze
```
Expected: Output showing download progress, may take several minutes on first run

**Step 2: Verify database exists**

Run:
```bash
ls -la ~/.garmindb/*.db
```
Expected: Files like `garmin.db`, `garmin_activities.db`, `garmin_monitoring.db`, `garmin_summary.db`

**Step 3: Verify data with quick query**

Run:
```bash
sqlite3 ~/.garmindb/garmin_summary.db "SELECT date, hr_min, hr_max, rhr FROM days_summary ORDER BY date DESC LIMIT 5;"
```
Expected: Recent days with heart rate data

---

### Task 6: Create Config Module

**Files:**
- Create: `src/config.ts`

**Step 1: Create config module**

Create `src/config.ts`:
```typescript
import { join } from "path";
import { homedir } from "os";

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

export const config = {
  // Garmin
  garminDbPath: expandPath(
    getEnvOrDefault("GARMINDB_PATH", "~/.garmindb")
  ),

  // Telegram
  telegramBotToken: () => getEnvOrThrow("TELEGRAM_BOT_TOKEN"),

  // Gemini
  geminiApiKey: () => getEnvOrThrow("GEMINI_API_KEY"),

  // Mem0
  mem0Url: getEnvOrDefault("MEM0_URL", "http://localhost:8080"),

  // Timeouts (ms)
  garminSyncTimeout: 30_000,
  geminiTimeout: 60_000,
  overallTimeout: 90_000,
} as const;
```

**Step 2: Update index.ts to use config**

Update `src/index.ts`:
```typescript
import { config } from "./config";

console.log("Kettl starting...");
console.log(`GarminDB path: ${config.garminDbPath}`);
```

**Step 3: Verify config loads**

Run:
```bash
cd /home/claude/ttd/kettl && bun run src/index.ts
```
Expected: Shows GarminDB path (expanded from ~)

**Step 4: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/config.ts src/index.ts && git commit -m "feat: add configuration module"
```

---

### Task 7: Create Garmin Database Types

**Files:**
- Create: `src/types/garmin.ts`
- Create: `src/types/index.ts`

**Step 1: Create types directory and garmin types**

Create `src/types/garmin.ts`:
```typescript
export interface DailySummary {
  date: string;
  steps: number | null;
  floors: number | null;
  hr_min: number | null;
  hr_max: number | null;
  rhr: number | null;
  stress_avg: number | null;
  bb_max: number | null;  // body battery
  bb_min: number | null;
  sleep_score: number | null;
}

export interface Activity {
  activity_id: string;
  name: string;
  type: string;
  start_time: string;
  elapsed_time: number;  // seconds
  distance: number | null;  // meters
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed: number | null;  // m/s
  calories: number | null;
}

export interface SleepSession {
  date: string;
  start_time: string;
  end_time: string;
  total_sleep: number;  // seconds
  deep_sleep: number | null;
  light_sleep: number | null;
  rem_sleep: number | null;
  awake: number | null;
  score: number | null;
}

export interface WeightEntry {
  date: string;
  weight: number;  // kg
}

export interface BodyBatteryEntry {
  date: string;
  bb_max: number;
  bb_min: number;
}
```

**Step 2: Create types index**

Create `src/types/index.ts`:
```typescript
export * from "./garmin";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/types && git commit -m "feat: add Garmin data types"
```

---

### Task 8: Create Garmin Query Functions

**Files:**
- Create: `src/garmin/queries.ts`
- Create: `src/garmin/index.ts`

**Step 1: Create queries module**

Create `src/garmin/queries.ts`:
```typescript
import { Database } from "bun:sqlite";
import { join } from "path";
import { config } from "../config";
import type {
  DailySummary,
  Activity,
  SleepSession,
  WeightEntry,
  BodyBatteryEntry,
} from "../types";

function openDb(name: string): Database {
  const path = join(config.garminDbPath, name);
  return new Database(path, { readonly: true });
}

export function getTodaysSummary(): DailySummary | null {
  const db = openDb("garmin_summary.db");
  try {
    const today = new Date().toISOString().split("T")[0];
    const row = db
      .query<DailySummary, [string]>(
        `SELECT date, steps, floors, hr_min, hr_max, rhr, stress_avg,
                bb_max, bb_min, sleep_score
         FROM days_summary
         WHERE date = ?`
      )
      .get(today);
    return row || null;
  } finally {
    db.close();
  }
}

export function getRecentActivities(days: number = 7): Activity[] {
  const db = openDb("garmin_activities.db");
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<Activity, [string]>(
        `SELECT activity_id, name, type, start_time, elapsed_time,
                distance, avg_hr, max_hr, avg_speed, calories
         FROM activities
         WHERE date(start_time) >= ?
         ORDER BY start_time DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function getActivityDetails(activityId: string): Activity | null {
  const db = openDb("garmin_activities.db");
  try {
    return db
      .query<Activity, [string]>(
        `SELECT activity_id, name, type, start_time, elapsed_time,
                distance, avg_hr, max_hr, avg_speed, calories
         FROM activities
         WHERE activity_id = ?`
      )
      .get(activityId);
  } finally {
    db.close();
  }
}

export function getSleepTrend(days: number = 7): SleepSession[] {
  const db = openDb("garmin.db");
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<SleepSession, [string]>(
        `SELECT date, start_time, end_time, total_sleep,
                deep_sleep, light_sleep, rem_sleep, awake, score
         FROM sleep
         WHERE date >= ?
         ORDER BY date DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function getWeightTrend(days: number = 30): WeightEntry[] {
  const db = openDb("garmin.db");
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<WeightEntry, [string]>(
        `SELECT date, weight
         FROM weight
         WHERE date >= ?
         ORDER BY date DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function getBodyBatteryTrend(days: number = 7): BodyBatteryEntry[] {
  const db = openDb("garmin_summary.db");
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    return db
      .query<BodyBatteryEntry, [string]>(
        `SELECT date, bb_max, bb_min
         FROM days_summary
         WHERE date >= ? AND bb_max IS NOT NULL
         ORDER BY date DESC`
      )
      .all(cutoffStr);
  } finally {
    db.close();
  }
}

export function queryGarmin(sql: string, dbName: string = "garmin.db"): unknown[] {
  const db = openDb(dbName);
  try {
    return db.query(sql).all();
  } finally {
    db.close();
  }
}
```

**Step 2: Create garmin index**

Create `src/garmin/index.ts`:
```typescript
export * from "./queries";
```

**Step 3: Update index.ts to test queries**

Update `src/index.ts`:
```typescript
import { config } from "./config";
import { getTodaysSummary, getRecentActivities } from "./garmin";

console.log("Kettl starting...");
console.log(`GarminDB path: ${config.garminDbPath}`);

// Test queries
const summary = getTodaysSummary();
console.log("\nToday's summary:", summary);

const activities = getRecentActivities(7);
console.log(`\nRecent activities (${activities.length}):`);
activities.forEach((a) => {
  console.log(`  - ${a.name} (${a.type}): ${a.distance ? (a.distance / 1000).toFixed(2) + "km" : "no distance"}`);
});
```

**Step 4: Test queries work**

Run:
```bash
cd /home/claude/ttd/kettl && bun run src/index.ts
```
Expected: Shows today's summary (may be null if no data today) and recent activities

**Step 5: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/garmin && git commit -m "feat: add Garmin SQLite query functions"
```

---

### Task 9: Create Garmin Sync Wrapper

**Files:**
- Create: `src/garmin/sync.ts`
- Update: `src/garmin/index.ts`

**Step 1: Create sync module**

Create `src/garmin/sync.ts`:
```typescript
import { spawn } from "bun";
import { join } from "path";
import { homedir } from "os";
import { config } from "../config";

export interface SyncResult {
  success: boolean;
  durationMs: number;
  error?: string;
}

// Generate GarminConnectConfig.json from env vars if it doesn't exist
async function ensureGarminConfig(): Promise<void> {
  const configDir = join(homedir(), ".GarminDb");
  const configPath = join(configDir, "GarminConnectConfig.json");

  // Check if config already exists
  const file = Bun.file(configPath);
  if (await file.exists()) {
    return;
  }

  // Get credentials from env
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;

  if (!email || !password) {
    throw new Error("GARMIN_EMAIL and GARMIN_PASSWORD must be set");
  }

  // Create config directory
  await Bun.spawn({ cmd: ["mkdir", "-p", configDir] }).exited;

  // Write config file
  const garminConfig = {
    credentials: {
      user: email,
      password: password,
    },
    data: {
      weight_start_date: "2020-01-01",
      sleep_start_date: "2020-01-01",
    },
    copy: {
      mount_dir: "",
    },
    enabled_stats: {
      monitoring: true,
      sleep: true,
      rhr: true,
      weight: true,
      activities: true,
    },
  };

  await Bun.write(configPath, JSON.stringify(garminConfig, null, 2));
}

export async function syncGarmin(): Promise<SyncResult> {
  const start = Date.now();

  try {
    // Ensure config exists before syncing
    await ensureGarminConfig();

    const proc = spawn({
      cmd: ["garmindb_cli.py", "--all", "--download", "--import", "--analyze"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => {
      proc.kill();
    }, config.garminSyncTimeout);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    const durationMs = Date.now() - start;

    if (exitCode === 0) {
      return { success: true, durationMs };
    } else {
      const stderr = await new Response(proc.stderr).text();
      return {
        success: false,
        durationMs,
        error: `Exit code ${exitCode}: ${stderr.slice(0, 200)}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Get timestamp of last sync (based on db modification time)
export function getLastSyncTime(): Date | null {
  try {
    const file = Bun.file(`${config.garminDbPath}/garmin.db`);
    // Bun.file doesn't expose mtime directly, use stat
    const stat = Bun.spawnSync({
      cmd: ["stat", "-c", "%Y", `${config.garminDbPath}/garmin.db`],
    });
    const timestamp = parseInt(stat.stdout.toString().trim());
    return isNaN(timestamp) ? null : new Date(timestamp * 1000);
  } catch {
    return null;
  }
}
```

**Step 2: Update garmin index**

Update `src/garmin/index.ts`:
```typescript
export * from "./queries";
export * from "./sync";
```

**Step 3: Test sync (optional, takes time)**

This step is optional as sync takes 2-30 seconds:
```bash
cd /home/claude/ttd/kettl && bun -e "import { syncGarmin } from './src/garmin'; syncGarmin().then(console.log)"
```

**Step 4: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/garmin/sync.ts src/garmin/index.ts && git commit -m "feat: add Garmin sync wrapper"
```

---

## Phase 2: LLM + Tool Loop

### Task 10: Create Tool Type Definitions

**Files:**
- Create: `src/types/tools.ts`
- Update: `src/types/index.ts`

**Step 1: Create tool types**

Create `src/types/tools.ts`:
```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  result: unknown;
  error?: string;
}
```

**Step 2: Update types index**

Update `src/types/index.ts`:
```typescript
export * from "./garmin";
export * from "./tools";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/types && git commit -m "feat: add tool type definitions"
```

---

### Task 11: Create Tool Registry

**Files:**
- Create: `src/tools/registry.ts`
- Create: `src/tools/index.ts`

**Step 1: Create tool registry**

Create `src/tools/registry.ts`:
```typescript
import type { ToolDefinition, ToolCall, ToolResult } from "../types";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        name: call.name,
        result: null,
        error: `Unknown tool: ${call.name}`,
      };
    }

    try {
      const result = await tool.handler(call.args);
      return { name: call.name, result };
    } catch (error) {
      return {
        name: call.name,
        result: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async executeAll(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.execute(call)));
  }
}

export const toolRegistry = new ToolRegistry();
```

**Step 2: Create tools index**

Create `src/tools/index.ts`:
```typescript
export { toolRegistry } from "./registry";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/tools && git commit -m "feat: add tool registry"
```

---

### Task 12: Register Garmin Tools

**Files:**
- Create: `src/tools/garmin.ts`
- Update: `src/tools/index.ts`

**Step 1: Create Garmin tools**

Create `src/tools/garmin.ts`:
```typescript
import { toolRegistry } from "./registry";
import {
  syncGarmin,
  getTodaysSummary,
  getRecentActivities,
  getActivityDetails,
  getSleepTrend,
  getWeightTrend,
  getBodyBatteryTrend,
  queryGarmin,
} from "../garmin";

// sync_garmin
toolRegistry.register(
  {
    name: "sync_garmin",
    description:
      "Force refresh data from Garmin Connect. Use when data might be stale or user just completed an activity.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    const result = await syncGarmin();
    if (result.success) {
      return { synced: true, durationMs: result.durationMs };
    } else {
      return { synced: false, error: result.error };
    }
  }
);

// get_todays_summary
toolRegistry.register(
  {
    name: "get_todays_summary",
    description:
      "Get today's health summary: steps, sleep score, stress, body battery, resting HR.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    return getTodaysSummary();
  }
);

// get_recent_activities
toolRegistry.register(
  {
    name: "get_recent_activities",
    description:
      "Get recent activities (runs, walks, rides, etc.) with distance, duration, HR, pace.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 7)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getRecentActivities(days);
  }
);

// get_activity_details
toolRegistry.register(
  {
    name: "get_activity_details",
    description:
      "Get detailed breakdown of a specific activity: HR zones, pace splits, cadence.",
    parameters: {
      type: "object",
      properties: {
        activity_id: {
          type: "string",
          description: "The activity ID to look up",
        },
      },
      required: ["activity_id"],
    },
  },
  async (args) => {
    const id = String(args.activity_id);
    return getActivityDetails(id);
  }
);

// get_sleep_trend
toolRegistry.register(
  {
    name: "get_sleep_trend",
    description:
      "Get sleep data over N days: duration, quality, deep/light/REM breakdown.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 7)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getSleepTrend(days);
  }
);

// get_weight_trend
toolRegistry.register(
  {
    name: "get_weight_trend",
    description: "Get weight measurements over N days.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 30)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 30;
    return getWeightTrend(days);
  }
);

// get_body_battery_trend
toolRegistry.register(
  {
    name: "get_body_battery_trend",
    description: "Get body battery (energy) patterns over N days.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Number of days to look back (default: 7)",
        },
      },
    },
  },
  async (args) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getBodyBatteryTrend(days);
  }
);

// query_garmin (escape hatch)
toolRegistry.register(
  {
    name: "query_garmin",
    description:
      "Execute raw SQL query against Garmin database. Use sparingly for edge cases not covered by other tools.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SQL query to execute",
        },
        db_name: {
          type: "string",
          description:
            "Database file name: garmin.db, garmin_activities.db, garmin_summary.db, or garmin_monitoring.db",
          enum: [
            "garmin.db",
            "garmin_activities.db",
            "garmin_summary.db",
            "garmin_monitoring.db",
          ],
        },
      },
      required: ["sql"],
    },
  },
  async (args) => {
    const sql = String(args.sql);
    const dbName = typeof args.db_name === "string" ? args.db_name : "garmin.db";
    return queryGarmin(sql, dbName);
  }
);
```

**Step 2: Update tools index**

Update `src/tools/index.ts`:
```typescript
export { toolRegistry } from "./registry";

// Register all tools by importing the modules
import "./garmin";
```

**Step 3: Test tool registration**

Run:
```bash
cd /home/claude/ttd/kettl && bun -e "import { toolRegistry } from './src/tools'; console.log(toolRegistry.getDefinitions().map(d => d.name))"
```
Expected: Array of tool names like `["sync_garmin", "get_todays_summary", ...]`

**Step 4: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/tools && git commit -m "feat: register Garmin tools"
```

---

### Task 13: Create Gemini Client

**Files:**
- Create: `src/agent/gemini.ts`
- Create: `src/agent/index.ts`

**Step 1: Create Gemini client**

Create `src/agent/gemini.ts`:
```typescript
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { config } from "../config";
import type { ToolDefinition, ToolCall } from "../types";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(config.geminiApiKey());
  }
  return client;
}

export interface GeminiResponse {
  text: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

export interface GeminiMessage {
  role: "user" | "model";
  parts: Part[];
}

export async function chat(
  messages: GeminiMessage[],
  tools: ToolDefinition[],
  systemPrompt: string
): Promise<GeminiResponse> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: systemPrompt,
    tools: tools.length > 0
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ]
      : undefined,
  });

  const chat = model.startChat({
    history: messages.slice(0, -1),
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.parts);
  const response = result.response;

  const toolCalls: ToolCall[] = [];
  let text: string | null = null;

  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if ("text" in part && part.text) {
        text = part.text;
      }
      if ("functionCall" in part && part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          args: (part.functionCall.args as Record<string, unknown>) || {},
        });
      }
    }
  }

  return {
    text,
    toolCalls,
    finishReason: response.candidates?.[0]?.finishReason || "UNKNOWN",
  };
}

export function createToolResultPart(
  name: string,
  result: unknown
): Part {
  return {
    functionResponse: {
      name,
      response: { result },
    },
  };
}
```

**Step 2: Create agent index**

Create `src/agent/index.ts`:
```typescript
export * from "./gemini";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/agent && git commit -m "feat: add Gemini client with function calling"
```

---

### Task 14: Create Agent Loop

**Files:**
- Create: `src/agent/loop.ts`
- Update: `src/agent/index.ts`

**Step 1: Create agent loop**

Create `src/agent/loop.ts`:
```typescript
import { chat, createToolResultPart, type GeminiMessage } from "./gemini";
import { toolRegistry } from "../tools";
import type { ToolResult } from "../types";

const MAX_TOOL_ROUNDS = 5;

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
}

export async function runAgent(
  userMessage: string,
  systemPrompt: string
): Promise<AgentResponse> {
  const tools = toolRegistry.getDefinitions();
  const messages: GeminiMessage[] = [
    { role: "user", parts: [{ text: userMessage }] },
  ];
  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await chat(messages, tools, systemPrompt);

    // If no tool calls, we're done
    if (response.toolCalls.length === 0) {
      return {
        text: response.text || "I couldn't generate a response.",
        toolsUsed,
      };
    }

    // Execute tool calls
    const results: ToolResult[] = await toolRegistry.executeAll(response.toolCalls);
    toolsUsed.push(...results.map((r) => r.name));

    // Add model response to history
    messages.push({
      role: "model",
      parts: response.toolCalls.map((tc) => ({
        functionCall: { name: tc.name, args: tc.args },
      })),
    });

    // Add tool results to history
    messages.push({
      role: "user",
      parts: results.map((r) =>
        createToolResultPart(r.name, r.error || r.result)
      ),
    });
  }

  // Exceeded max rounds, ask for final response without tools
  const finalResponse = await chat(messages, [], systemPrompt);
  return {
    text:
      finalResponse.text ||
      "I used several tools but couldn't formulate a final response.",
    toolsUsed,
  };
}
```

**Step 2: Update agent index**

Update `src/agent/index.ts`:
```typescript
export * from "./gemini";
export * from "./loop";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/agent && git commit -m "feat: add agentic tool loop"
```

---

### Task 15: Create System Prompts

**Files:**
- Create: `src/prompts.ts`

**Step 1: Create prompts module**

Create `src/prompts.ts`:
```typescript
export const BOOTSTRAP_PROMPT = `You're starting fresh with a new user who wants health/fitness coaching.

Your job: understand who they are and what they want.

Explore:
- Primary goal (weight loss, running performance, general health, habit building)
- Specific targets if any (goal weight, race, etc.)
- Timeline and urgency
- Coaching style preference (data-heavy, conversational, tough love, gentle encouragement)
- Constraints (injuries, dietary restrictions, schedule limitations)
- What they've tried before

Save everything important using save_insight with category "user_profile".
This context loads automatically in future conversations.

Be conversational, not a form. Build rapport.`;

export const MAIN_PROMPT = `You're a personal health coach with access to the user's Garmin data and conversation history.

Data is current - synced moments before this message.

Your approach:
- Reference actual data, not assumptions
- Be concise but warm
- Ask clarifying questions when needed
- Notice patterns across days/weeks
- Celebrate progress, address setbacks constructively
- Remember past conversations and commitments

Tool usage:
- Always get_todays_summary for context on general check-ins
- Use search_memories when user references past discussions or goals
- Save insights when you notice patterns or user shares something important
- Sync is automatic, but call sync_garmin if user just finished a workout

Memory categories: user_profile, goals, food_impacts, training_patterns, weekly_summaries

Don't over-explain. Don't be sycophantic. Be a good coach.`;
```

**Step 2: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/prompts.ts && git commit -m "feat: add system prompts"
```

---

### Task 16: Create CLI Test Harness

**Files:**
- Create: `src/cli.ts`

**Step 1: Create CLI test harness**

Create `src/cli.ts`:
```typescript
import { runAgent } from "./agent";
import { MAIN_PROMPT } from "./prompts";
import { createInterface } from "readline";

// Ensure tools are registered
import "./tools";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("Kettl CLI Test Harness");
console.log("Type your message and press Enter. Type 'exit' to quit.\n");

function prompt(): void {
  rl.question("You: ", async (input) => {
    const trimmed = input.trim();
    if (trimmed.toLowerCase() === "exit") {
      console.log("Goodbye!");
      rl.close();
      return;
    }

    if (!trimmed) {
      prompt();
      return;
    }

    try {
      console.log("\n[Processing...]");
      const response = await runAgent(trimmed, MAIN_PROMPT);
      console.log(`\nKettl: ${response.text}`);
      if (response.toolsUsed.length > 0) {
        console.log(`[Tools used: ${response.toolsUsed.join(", ")}]`);
      }
      console.log();
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : error
      );
      console.log();
    }

    prompt();
  });
}

prompt();
```

**Step 2: Add cli script to package.json**

Update `package.json` scripts section:
```json
"scripts": {
  "dev": "bun run --watch src/index.ts",
  "start": "bun run src/index.ts",
  "cli": "bun run src/cli.ts",
  "test": "bun test"
}
```

**Step 3: Test CLI (requires GEMINI_API_KEY)**

Run:
```bash
cd /home/claude/ttd/kettl && GEMINI_API_KEY=your-key-here bun run cli
```
Then try: "How did I sleep this week?"

**Step 4: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/cli.ts package.json && git commit -m "feat: add CLI test harness"
```

---

## Phase 3: Memory Layer

### Task 17: Create Docker Compose for Mem0 + Qdrant

**Files:**
- Create: `docker-compose.yml`

**Step 1: Create docker-compose.yml**

Create `docker-compose.yml`:
```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped

  mem0:
    image: mem0ai/mem0:latest
    ports:
      - "8080:8080"
    environment:
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      # Mem0 needs an LLM for extraction - we'll configure Gemini
      - LLM_PROVIDER=google
      - GOOGLE_API_KEY=${GEMINI_API_KEY}
      - EMBEDDER_PROVIDER=google
    depends_on:
      - qdrant
    restart: unless-stopped

volumes:
  qdrant_data:
```

**Step 2: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add docker-compose.yml && git commit -m "feat: add Docker Compose for Mem0 + Qdrant"
```

---

### Task 18: Create Memory Types

**Files:**
- Create: `src/types/memory.ts`
- Update: `src/types/index.ts`

**Step 1: Create memory types**

Create `src/types/memory.ts`:
```typescript
export type MemoryCategory =
  | "user_profile"
  | "goals"
  | "food_impacts"
  | "training_patterns"
  | "weekly_summaries";

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
}
```

**Step 2: Update types index**

Update `src/types/index.ts`:
```typescript
export * from "./garmin";
export * from "./tools";
export * from "./memory";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/types && git commit -m "feat: add memory types"
```

---

### Task 19: Create Mem0 Client

**Files:**
- Create: `src/memory/client.ts`
- Create: `src/memory/index.ts`

**Step 1: Create Mem0 client**

Create `src/memory/client.ts`:
```typescript
import { config } from "../config";
import type { Memory, MemoryCategory, MemorySearchResult } from "../types";

const USER_ID = "kettl-user"; // Single user, hardcoded

async function mem0Fetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url = `${config.mem0Url}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mem0 error (${response.status}): ${text}`);
  }

  return response;
}

export async function searchMemories(
  query: string,
  category?: MemoryCategory,
  limit: number = 5
): Promise<MemorySearchResult[]> {
  const body: Record<string, unknown> = {
    query,
    user_id: USER_ID,
    limit,
  };

  if (category) {
    body.metadata = { category };
  }

  const response = await mem0Fetch("/v1/memories/search", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return (data.results || []).map((r: any) => ({
    memory: {
      id: r.id,
      content: r.memory,
      category: r.metadata?.category || "user_profile",
      createdAt: r.created_at,
      metadata: r.metadata,
    },
    score: r.score,
  }));
}

export async function saveInsight(
  content: string,
  category: MemoryCategory
): Promise<Memory> {
  const response = await mem0Fetch("/v1/memories", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content }],
      user_id: USER_ID,
      metadata: { category },
    }),
  });

  const data = await response.json();
  const created = data.results?.[0];

  return {
    id: created?.id || "unknown",
    content,
    category,
    createdAt: new Date().toISOString(),
    metadata: { category },
  };
}

export async function getUserProfile(): Promise<Memory[]> {
  return (await searchMemories("user profile goals preferences", "user_profile", 10))
    .map((r) => r.memory);
}

export async function isMemoryAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.mem0Url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

**Step 2: Create memory index**

Create `src/memory/index.ts`:
```typescript
export * from "./client";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/memory && git commit -m "feat: add Mem0 client"
```

---

### Task 20: Register Memory Tools

**Files:**
- Create: `src/tools/memory.ts`
- Update: `src/tools/index.ts`

**Step 1: Create memory tools**

Create `src/tools/memory.ts`:
```typescript
import { toolRegistry } from "./registry";
import {
  searchMemories,
  saveInsight,
  getUserProfile,
  isMemoryAvailable,
} from "../memory";
import type { MemoryCategory } from "../types";

const VALID_CATEGORIES: MemoryCategory[] = [
  "user_profile",
  "goals",
  "food_impacts",
  "training_patterns",
  "weekly_summaries",
];

// search_memories
toolRegistry.register(
  {
    name: "search_memories",
    description:
      "Search past conversations and saved insights for relevant context. Use when user references past discussions, goals, or patterns.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for",
        },
        category: {
          type: "string",
          description: "Optional category to filter by",
          enum: VALID_CATEGORIES,
        },
      },
      required: ["query"],
    },
  },
  async (args) => {
    if (!(await isMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const query = String(args.query);
    const category = args.category as MemoryCategory | undefined;
    const results = await searchMemories(query, category);
    return results.map((r) => ({
      content: r.memory.content,
      category: r.memory.category,
      relevance: r.score,
    }));
  }
);

// save_insight
toolRegistry.register(
  {
    name: "save_insight",
    description:
      "Save an important insight, pattern, or user preference for future reference. Be selective - only save things worth remembering.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The insight to save",
        },
        category: {
          type: "string",
          description: "Category for organizing",
          enum: VALID_CATEGORIES,
        },
      },
      required: ["content", "category"],
    },
  },
  async (args) => {
    if (!(await isMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const content = String(args.content);
    const category = args.category as MemoryCategory;
    if (!VALID_CATEGORIES.includes(category)) {
      return { error: `Invalid category. Use one of: ${VALID_CATEGORIES.join(", ")}` };
    }
    const memory = await saveInsight(content, category);
    return { saved: true, id: memory.id };
  }
);

// get_user_profile
toolRegistry.register(
  {
    name: "get_user_profile",
    description:
      "Retrieve the user's core profile: goals, preferences, coaching style, constraints.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  async () => {
    if (!(await isMemoryAvailable())) {
      return { error: "Memory service unavailable" };
    }
    const memories = await getUserProfile();
    if (memories.length === 0) {
      return { hasProfile: false, message: "No user profile found. This may be a new user." };
    }
    return {
      hasProfile: true,
      profile: memories.map((m) => m.content),
    };
  }
);
```

**Step 2: Update tools index**

Update `src/tools/index.ts`:
```typescript
export { toolRegistry } from "./registry";

// Register all tools by importing the modules
import "./garmin";
import "./memory";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/tools && git commit -m "feat: register memory tools"
```

---

### Task 21: Test Memory Integration

**Files:**
- None (integration test)

**Step 1: Start Mem0 + Qdrant**

Run:
```bash
cd /home/claude/ttd/kettl && docker compose up -d
```

**Step 2: Wait for services to be ready**

Run:
```bash
sleep 10 && curl -s http://localhost:8080/health
```
Expected: Health check response

**Step 3: Test via CLI**

Run:
```bash
cd /home/claude/ttd/kettl && GEMINI_API_KEY=your-key bun run cli
```
Then try:
- "Remember that I want to run a sub-4 hour marathon"
- "What are my goals?"

**Step 4: Stop services (optional)**

Run:
```bash
cd /home/claude/ttd/kettl && docker compose down
```

---

## Phase 4: Telegram Integration

### Task 22: Create Telegram Bot Handler

**Files:**
- Create: `src/telegram/bot.ts`
- Create: `src/telegram/index.ts`

**Step 1: Create bot module**

Create `src/telegram/bot.ts`:
```typescript
import { Bot, Context } from "grammy";
import { config } from "../config";
import { runAgent } from "../agent";
import { syncGarmin } from "../garmin";
import { isMemoryAvailable, getUserProfile } from "../memory";
import { MAIN_PROMPT, BOOTSTRAP_PROMPT } from "../prompts";

// Ensure tools are registered
import "../tools";

let bot: Bot | null = null;

export function createBot(): Bot {
  if (bot) return bot;

  bot = new Bot(config.telegramBotToken());

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hey! I'm Kettl, your health coach. I have access to your Garmin data and I'll remember our conversations.\n\n" +
        "Just message me about your workouts, sleep, goals, or anything health-related."
    );
  });

  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;

    try {
      // Send typing indicator
      await ctx.replyWithChatAction("typing");

      // Sync Garmin data (don't block on failure)
      const syncPromise = syncGarmin().catch((e) => {
        console.warn("Garmin sync failed:", e);
        return { success: false };
      });

      // Check if user has profile (determines bootstrap vs main prompt)
      let systemPrompt = MAIN_PROMPT;
      const memoryAvailable = await isMemoryAvailable();

      if (memoryAvailable) {
        const profile = await getUserProfile();
        if (profile.length === 0) {
          systemPrompt = BOOTSTRAP_PROMPT;
        }
      }

      // Wait for sync to complete (with timeout already built in)
      await syncPromise;

      // Run agent
      const response = await runAgent(userMessage, systemPrompt);

      // Send response
      await ctx.reply(response.text, { parse_mode: "Markdown" });

      // Log tools used (for debugging)
      if (response.toolsUsed.length > 0) {
        console.log(`Tools used: ${response.toolsUsed.join(", ")}`);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      await ctx.reply(
        "Sorry, I ran into an issue. Try again in a moment?"
      );
    }
  });

  return bot;
}

export async function startBot(): Promise<void> {
  const b = createBot();
  console.log("Starting Telegram bot...");
  await b.start();
}
```

**Step 2: Create telegram index**

Create `src/telegram/index.ts`:
```typescript
export * from "./bot";
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/telegram && git commit -m "feat: add Telegram bot handler"
```

---

### Task 23: Update Entry Point

**Files:**
- Update: `src/index.ts`

**Step 1: Update index.ts**

Update `src/index.ts`:
```typescript
import { startBot } from "./telegram";

// Ensure all tools are registered
import "./tools";

console.log("Kettl starting...");

startBot()
  .then(() => console.log("Bot started successfully"))
  .catch((error) => {
    console.error("Failed to start bot:", error);
    process.exit(1);
  });
```

**Step 2: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/index.ts && git commit -m "feat: wire up Telegram bot entry point"
```

---

### Task 24: Add Error Handling and Timeouts

**Files:**
- Create: `src/utils/timeout.ts`
- Update: `src/telegram/bot.ts`

**Step 1: Create timeout utility**

Create `src/utils/timeout.ts`:
```typescript
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string = "Operation timed out"
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new TimeoutError(message)), ms);
    }),
  ]);
}
```

**Step 2: Update bot with timeouts**

Update `src/telegram/bot.ts`:
```typescript
import { Bot, Context } from "grammy";
import { config } from "../config";
import { runAgent } from "../agent";
import { syncGarmin, getLastSyncTime } from "../garmin";
import { isMemoryAvailable, getUserProfile } from "../memory";
import { MAIN_PROMPT, BOOTSTRAP_PROMPT } from "../prompts";
import { withTimeout, TimeoutError } from "../utils/timeout";

// Ensure tools are registered
import "../tools";

let bot: Bot | null = null;

function formatTimeSince(date: Date | null): string {
  if (!date) return "unknown";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  return `${hours} hours ago`;
}

export function createBot(): Bot {
  if (bot) return bot;

  bot = new Bot(config.telegramBotToken());

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Hey! I'm Kettl, your health coach. I have access to your Garmin data and I'll remember our conversations.\n\n" +
        "Just message me about your workouts, sleep, goals, or anything health-related."
    );
  });

  bot.on("message:text", async (ctx) => {
    const userMessage = ctx.message.text;
    const warnings: string[] = [];

    try {
      // Send typing indicator
      await ctx.replyWithChatAction("typing");

      // Sync Garmin data (don't block on failure)
      const syncResult = await syncGarmin().catch((e) => {
        console.warn("Garmin sync failed:", e);
        return { success: false, error: String(e) };
      });

      if (!syncResult.success) {
        const lastSync = getLastSyncTime();
        warnings.push(`Garmin sync failed, using data from ${formatTimeSince(lastSync)}`);
      }

      // Check memory availability and get prompt
      let systemPrompt = MAIN_PROMPT;
      const memoryAvailable = await isMemoryAvailable();

      if (!memoryAvailable) {
        warnings.push("Memory unavailable, I may repeat myself");
      } else {
        const profile = await getUserProfile();
        if (profile.length === 0) {
          systemPrompt = BOOTSTRAP_PROMPT;
        }
      }

      // Run agent with overall timeout
      const response = await withTimeout(
        runAgent(userMessage, systemPrompt),
        config.overallTimeout,
        "Response took too long"
      );

      // Build response text
      let replyText = response.text;
      if (warnings.length > 0) {
        replyText += `\n\n_${warnings.join(". ")}_`;
      }

      // Send response
      await ctx.reply(replyText, { parse_mode: "Markdown" });

      // Log tools used
      if (response.toolsUsed.length > 0) {
        console.log(`Tools used: ${response.toolsUsed.join(", ")}`);
      }
    } catch (error) {
      console.error("Error handling message:", error);

      if (error instanceof TimeoutError) {
        await ctx.reply(
          "That took too long, sorry! Try again with a simpler question?"
        );
      } else {
        await ctx.reply(
          "Sorry, I ran into an issue. Try again in a moment?"
        );
      }
    }
  });

  return bot;
}

export async function startBot(): Promise<void> {
  const b = createBot();
  console.log("Starting Telegram bot...");
  await b.start();
}
```

**Step 3: Create utils index**

Create `src/utils/index.ts`:
```typescript
export * from "./timeout";
```

**Step 4: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add src/utils src/telegram && git commit -m "feat: add error handling and timeouts"
```

---

### Task 25: Create Dockerfile

**Files:**
- Create: `Dockerfile`

**Step 1: Create Dockerfile**

Create `Dockerfile`:
```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install Python for GarminDB
RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*
RUN pip3 install garmindb --break-system-packages

# Copy package files
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Run
CMD ["bun", "run", "src/index.ts"]
```

**Step 2: Update docker-compose.yml to include kettl**

Update `docker-compose.yml`:
```yaml
services:
  kettl:
    build: .
    env_file:
      - .env
    volumes:
      - ~/.garmindb:/root/.garmindb
      - ~/.GarminDb:/root/.GarminDb
    depends_on:
      - mem0
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    restart: unless-stopped

  mem0:
    image: mem0ai/mem0:latest
    ports:
      - "8080:8080"
    environment:
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - LLM_PROVIDER=google
      - GOOGLE_API_KEY=${GEMINI_API_KEY}
      - EMBEDDER_PROVIDER=google
    depends_on:
      - qdrant
    restart: unless-stopped

volumes:
  qdrant_data:
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add Dockerfile docker-compose.yml && git commit -m "feat: add Dockerfile and update compose for full stack"
```

---

### Task 26: Test Full Stack

**Files:**
- None (integration test)

**Step 1: Create .env with all credentials**

Ensure `.env` has all values filled:
```
GARMIN_EMAIL=your-email
GARMIN_PASSWORD=your-password
TELEGRAM_BOT_TOKEN=your-token
GEMINI_API_KEY=your-key
MEM0_URL=http://mem0:8080
GARMINDB_PATH=/root/.garmindb
```

**Step 2: Build and start**

Run:
```bash
cd /home/claude/ttd/kettl && docker compose up --build -d
```

**Step 3: Check logs**

Run:
```bash
cd /home/claude/ttd/kettl && docker compose logs -f kettl
```
Expected: "Bot started successfully"

**Step 4: Test via Telegram**

Send a message to your bot in Telegram:
- "How am I doing today?"
- "How did I sleep this week?"

**Step 5: Stop if needed**

Run:
```bash
cd /home/claude/ttd/kettl && docker compose down
```

---

## Phase 5: Tuning (Optional Tasks)

### Task 27: Add Cron Script for Backup Sync

**Files:**
- Create: `scripts/sync-garmin.sh`

**Step 1: Create sync script**

Create `scripts/sync-garmin.sh`:
```bash
#!/bin/bash
# Backup sync for Garmin data
# Add to cron: */10 * * * * /path/to/kettl/scripts/sync-garmin.sh

set -e
garmindb_cli.py --all --download --import --analyze 2>&1 | tail -5
```

**Step 2: Make executable**

Run:
```bash
chmod +x /home/claude/ttd/kettl/scripts/sync-garmin.sh
```

**Step 3: Commit**

Run:
```bash
cd /home/claude/ttd/kettl && git add scripts && git commit -m "feat: add backup sync cron script"
```

---

### Task 28: Add Health Check Endpoint (Optional)

**Files:**
- Create: `src/health.ts`

This task is optional and can be skipped if not needed for monitoring.

---

## Summary

This plan implements Kettl in 5 phases with 27-28 tasks:

- **Phase 1 (Tasks 1-9):** Data foundation - Bun, GarminDB, SQLite queries
- **Phase 2 (Tasks 10-16):** LLM + tool loop - Gemini, tool registry, CLI harness
- **Phase 3 (Tasks 17-21):** Memory layer - Mem0, Qdrant, memory tools
- **Phase 4 (Tasks 22-26):** Telegram integration - grammY, error handling, Docker
- **Phase 5 (Tasks 27-28):** Tuning - cron, optional health checks

Each task has bite-sized steps with exact commands and expected outputs.
