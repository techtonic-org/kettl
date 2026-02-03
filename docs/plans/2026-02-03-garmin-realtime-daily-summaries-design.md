# Garmin Real-time API & Daily Summaries System

## Overview

This design introduces a two-tier data system for Garmin health data and a daily summaries archive for better context management and traceability.

**Goals:**
- Reduce reliance on slow GarminDB syncs for real-time queries
- Build historical context automatically via daily summaries
- Provide Gemini with clear guidance on data freshness
- Create a human-readable archive of health data and conversations

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GARMIN DATA                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   TIER 1: SQLite (GarminDB)          TIER 2: Instant API        │
│   ─────────────────────────          ──────────────────         │
│   - Full historical data              - Real-time snapshots     │
│   - Well-structured, queryable        - Latest activities       │
│   - Refreshed every 4 hours           - Current HR/stress/BB    │
│   - Trends, aggregates, details       - Today's sleep           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DAILY SUMMARIES                             │
│   ./data/summaries/2026-01-15.md                                │
│   - Generated at midnight (configurable)                        │
│   - Combines: Garmin data + chat interactions                   │
│   - Backfilled from START_DATE on first run                     │
│   - Human-readable archive + loaded into Mem0                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MEM0 MEMORY                              │
│   - Semantic search across all summaries                        │
│   - Patterns, insights, user profile                            │
│   - Two sources: daily summaries + conversation insights        │
└─────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Scheduled GarminDB Sync

**Current behavior:**
- Background sync on startup (if DBs don't exist)
- Per-message incremental sync

**New behavior:**
- Background sync on startup (unchanged)
- **Remove per-message sync** (instant API covers this gap)
- **4-hour interval sync** via `setInterval`
- **EOD forced sync** before daily summary generation
- **Smart scheduling:** If 4-hour interval would trigger within 1 hour of EOD, skip it and let EOD handle the sync

**Implementation:** `src/garmin/scheduler.ts`

### 2. Instant Garmin API Client

Uses `garmin-connect` npm package for real-time API calls without full GarminDB sync.

**Capabilities:**
- `getActivities(start, limit)` - Recent activities
- `getUserSummary(date)` - Daily summary (steps, HR, stress, body battery)
- `getSleepData(date)` - Sleep details
- `getHeartRate(date)` - HR data for specific day
- `getSteps(date)` - Step count

**Authentication:**
- Reuse `GARMIN_EMAIL` and `GARMIN_PASSWORD` env vars
- Session managed by the library (handles token refresh)
- Initialize client on startup, keep alive

**Timeout:** 10 seconds per call

**Implementation:** `src/garmin/instant.ts`

### 3. New Gemini Tools

#### Instant Garmin Tools (`src/tools/instant-garmin.ts`)

| Tool | Parameters | Returns | Use Case |
|------|------------|---------|----------|
| `get_latest_activities` | `limit?: number` | Activities since last SQLite sync | "How was my run today?" (just finished) |
| `get_current_vitals` | none | HR, stress, body battery, steps | "What's my stress right now?" |
| `get_todays_sleep` | none | Last night's sleep data | "How did I sleep?" (before SQLite syncs) |

#### Daily Summary Tool (`src/tools/summaries.ts`)

| Tool | Parameters | Returns | Use Case |
|------|------------|---------|----------|
| `get_daily_summary` | `date: string` | Markdown summary for that day | "What happened on Jan 15th?" |

### 4. Daily Summaries System

#### Summary Format

File: `./data/summaries/2026-01-15.md`

```markdown
# Daily Summary - 2026-01-15

## Activities
- **Morning Run** - 5.2km, 28:34, avg HR 152, max HR 178
- **Evening Walk** - 2.1km, 25:00

## Vitals
- Steps: 12,450
- Resting HR: 58 bpm
- Stress avg: 32
- Body Battery: 45 → 78 (recovered well)

## Sleep (previous night)
- Total: 7h 12m (score: 82)
- Deep: 1h 45m | REM: 1h 30m | Light: 4h
- Woke up 2x

## Chat Interactions
- Discussed post-run nutrition timing
- Set goal: sub-25min 5K by March

## Patterns Noticed
- HR recovery faster than last week
- Sleep score improving with earlier bedtime
```

#### Generation Process

1. Force GarminDB sync (ensure complete day data)
2. Query SQLite for day's activities, vitals, sleep
3. Pull any instant API data if needed
4. Load chat logs from that day
5. Send to Gemini with summary generation prompt
6. Write markdown file
7. Save summary to Mem0 with category `daily_summary`

**Implementation:** `src/summaries/generator.ts`

#### EOD Scheduling

- Runs at `SUMMARY_HOUR` (default: 0 = midnight)
- Uses configured `TZ` timezone
- Forces GarminDB sync before generation

**Implementation:** `src/summaries/scheduler.ts`

### 5. Chat Log Persistence

To include chat interactions in daily summaries, we persist them.

**Format:** `./data/chats/2026-01-15.jsonl`

```json
{"time": "14:32", "user": "How was my run?", "assistant": "Great pace! You hit 5:28/km avg..."}
{"time": "18:45", "user": "What should I eat tonight?", "assistant": "Given your workout..."}
```

**Changes to `src/telegram/bot.ts`:**
- After each message/response exchange, append to today's chat file
- Simple `appendFile` operation

**Implementation:** `src/chats/store.ts`

### 6. Backfill Process

On first startup, generate missing daily summaries from historical SQLite data.

**Flow:**

1. Wait for initial GarminDB sync to complete
2. Calculate date range: `GARMIN_START_DATE` to yesterday
3. Check `./data/summaries/` for existing files
4. For each missing day:
   - Generate summary from SQLite data (no chat logs for historical days)
   - Write markdown file
   - Load into Mem0 with category `daily_summary`
   - 1-2 second delay between days (Gemini rate limits)
5. Log progress: "Backfilled 45/180 days..."

**Idempotent:** Only generates missing files, safe to restart mid-backfill.

**Implementation:** `src/summaries/backfill.ts`

### 7. Dynamic System Prompt

The main prompt now includes runtime context:

```typescript
function buildMainPrompt(context: {
  lastSyncTime: Date,
  lastSyncAgo: string,      // "2 hours ago"
  messageTime: Date,
  messageTimeLocal: string  // "14:32"
}) {
  return `
You are Kettl, a health coaching assistant...

## Current Context

**Message received:** ${context.messageTimeLocal} (${context.messageTime.toISOString()})
**SQLite last synced:** ${context.lastSyncAgo}

## Data Freshness

**SQLite Data (GarminDB):** Last synced ${context.lastSyncAgo} (${context.lastSyncTime.toISOString()})
- Use for: trends, historical analysis, aggregates, detailed activity breakdowns
- Tools: get_todays_summary, get_recent_activities, get_sleep_trend, etc.

**Instant API:** Real-time, always fresh
- Use for: anything that happened since last sync, current state
- Tools: get_latest_activities, get_current_vitals, get_todays_sleep

**Daily Summaries:** Structured archive of each day
- Use for: "what happened on X date", reviewing past days
- Tool: get_daily_summary

**Rule of thumb:** If the user asks about "now" or "today" and sync was >1 hour ago, prefer instant API tools.
`
}
```

**Implementation:** Changes to `src/prompts.ts`

## Environment Variables

```bash
# Existing (unchanged)
GARMIN_EMAIL=...
GARMIN_PASSWORD=...
GARMIN_START_DATE=2025-08-01      # Sync & backfill start date
GARMIN_ACTIVITY_COUNT=200
GARMINDB_PATH=~/HealthData/DBs
TELEGRAM_BOT_TOKEN=...
GEMINI_API_KEY=...
MEM0_URL=http://localhost:8080

# New
GARMIN_SYNC_INTERVAL_HOURS=4      # Full SQLite sync interval (default: 4)
SUMMARY_HOUR=0                    # Hour to generate daily summary (default: 0 = midnight)
SUMMARIES_PATH=./data/summaries   # Daily summary markdown files
CHATS_PATH=./data/chats           # Chat log storage
TZ=Europe/Amsterdam               # Timezone for scheduling
```

## Docker Configuration

```yaml
volumes:
  - ./data/summaries:/app/data/summaries
  - ./data/chats:/app/data/chats
```

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/garmin/instant.ts` | Garmin Connect API client (real-time data) |
| `src/garmin/scheduler.ts` | 4-hour sync scheduler with EOD coordination |
| `src/tools/instant-garmin.ts` | New instant API tools for Gemini |
| `src/summaries/generator.ts` | Daily summary markdown generation |
| `src/summaries/backfill.ts` | Startup backfill for missing days |
| `src/summaries/scheduler.ts` | EOD summary scheduling |
| `src/tools/summaries.ts` | `get_daily_summary` tool |
| `src/chats/store.ts` | Chat log persistence |

### Modified Files

| File | Changes |
|------|---------|
| `src/index.ts` | Start schedulers, run backfill on startup |
| `src/config.ts` | Add new env vars |
| `src/prompts.ts` | Dynamic prompt with sync time + message time |
| `src/telegram/bot.ts` | Inject context into prompt, persist chats, remove per-message sync |
| `package.json` | Add `garmin-connect` dependency |

## Startup Sequence

1. Initial GarminDB sync (if needed)
2. Initialize Garmin Connect API client
3. Run backfill for missing daily summaries → load into Mem0
4. Start 4-hour sync scheduler
5. Start EOD summary scheduler
6. Start Telegram bot

## Testing Considerations

- Mock `garmin-connect` API responses for unit tests
- Test scheduler coordination (4h vs EOD timing)
- Test backfill idempotency (restart mid-backfill)
- Test summary generation with missing chat logs (historical days)
- Test timezone handling for EOD scheduling
