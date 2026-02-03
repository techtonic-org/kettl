# Kettl Design

A self-hosted health coaching bot that connects Garmin data with an LLM that has persistent memory.

## Core Concept

Kettl is a single-user health coaching bot that lives in Telegram. It connects your Garmin data with an LLM that has persistent memory, creating a coach that knows your history, goals, and patterns.

**The core loop:**
1. You message the bot (post-run, morning check-in, logging food, whatever)
2. Bot syncs fresh Garmin data (2-3 seconds)
3. LLM decides what tools to call based on your message and its memories
4. Bot responds with data-backed insights, remembering context for next time

**What makes it useful:**
- **Pattern spotter**: "Your pace drops 15 sec/km when you sleep under 6.5 hours" - correlations you'd never notice
- **Accountability partner**: "You said you'd take a rest day after hard runs - yesterday was hard, how are you feeling?"
- **Friction-free logging**: Just say "had pizza at 11pm" and it files that away, correlates with tomorrow's sleep

**What it's not:**
- Not a dashboard (passive visualization doesn't drive engagement)
- Not multi-user (just you, keeps it simple)
- Not real-time (Garmin Connect is source of truth, synced on demand)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Kettl (Bun/TS)                    │
│                                                     │
│   Telegram Bot ←→ LLM Client ←→ Tool Executor      │
│        │              │              │              │
│        ▼              ▼              ▼              │
│   grammY         Gemini API    Tools Registry      │
└─────────────────────────────────────────────────────┘
        │                              │
        │         ┌────────────────────┼────────────┐
        │         │                    │            │
        │         ▼                    ▼            ▼
        │    ┌─────────┐         ┌─────────┐   ┌─────────┐
        │    │  Mem0   │         │ Qdrant  │   │ Garmin  │
        │    │  API    │←───────→│ Vectors │   │ SQLite  │
        │    └─────────┘         └─────────┘   └─────────┘
        │         │                                 ▲
        ▼         ▼                                 │
   Telegram    Docker                    GarminDB CLI (Python)
   Cloud       Compose                   syncs to ~/.garmindb/
```

**Components:**
- **Kettl container**: Bun app with Telegram bot, LLM client, tool executor
- **Mem0 container**: Memory API with smart extraction
- **Qdrant container**: Vector storage for Mem0
- **GarminDB**: Python CLI called from Kettl, writes to mounted SQLite

**External dependencies:**
- Telegram Bot API (free)
- Gemini API (~$5-15/month at moderate usage)

## Tools & Data Access

### Garmin Tools

| Tool | Purpose |
|------|---------|
| `sync_garmin` | Force refresh from Garmin Connect |
| `get_todays_summary` | Steps, sleep score, stress, body battery, resting HR |
| `get_recent_activities` | Runs/walks/rides with distance, duration, HR, pace |
| `get_activity_details` | Deep dive: HR zones, pace splits, cadence |
| `get_sleep_trend` | Sleep duration, quality, stages over N days |
| `get_weight_trend` | Weight over N days |
| `get_body_battery_trend` | Energy patterns over N days |
| `query_garmin` | Raw SQL escape hatch (for edge cases) |

### Memory Tools

| Tool | Purpose |
|------|---------|
| `search_memories` | Find relevant past context (goals, patterns, notes) |
| `save_insight` | Store something important for future |
| `get_user_profile` | Core goals and preferences |

### Memory Categories

- `user_profile` - Goals, preferences, constraints
- `goals` - Specific targets (race times, weight, habits)
- `food_impacts` - "Pizza late = bad sleep"
- `training_patterns` - What works, injuries, recovery needs
- `weekly_summaries` - Auto-generated rollups

## Coaching Behavior

### First Conversation (Bootstrap)

The bot doesn't know you yet. It asks about:
- Primary goal (performance, weight, general health)
- Specific targets if any
- Coaching style preference (pattern spotter + accountability)
- Constraints (injuries, diet, schedule)
- What you've tried before

Everything gets saved to `user_profile`. This only happens once.

### Ongoing Conversations

The bot loads your profile and relevant memories before responding. Its personality:
- **Data-first**: References actual numbers, not generic advice
- **Pattern-focused**: Actively looks for correlations across days/weeks
- **Accountability-aware**: Remembers commitments, checks in on them
- **Concise**: No walls of text, no sycophantic fluff
- **Proactive saving**: Notices things worth remembering, saves them automatically

### Example Interactions

- "Just finished a run" → Syncs, pulls activity, compares to recent runs, notes anything interesting
- "Had beers last night" → Saves it, might correlate with tomorrow's sleep/HRV
- "How's my week going?" → Pulls multi-day trends, checks against goals
- "Am I ready for a hard workout?" → Looks at body battery, sleep, recent training load

## Error Handling & Resilience

Graceful degradation - never fully block on partial failures:

| Failure | Behavior |
|---------|----------|
| Garmin sync fails | Respond with cached data, note "working with data from X hours ago" |
| Mem0 unavailable | Respond without memory context, note "memory unavailable, I may repeat myself" |
| Gemini timeout | Retry once silently, then apologize and suggest trying again |
| GarminDB stale | Cron backup sync every 10 min ensures data is never more than ~10 min old |

### Sync Strategy

- **Primary**: Sync on every message (freshness matters)
- **Fallback**: Cron job every 10 minutes as safety net
- **Manual**: `sync_garmin` tool if you say "just finished a run"

### Timeouts

- Garmin sync: 30 second timeout (usually 2-3s, but Garmin can be slow)
- Gemini API: 60 second timeout for tool-heavy responses
- Overall message handling: 90 seconds max, then apologize

## Implementation Phases

### Phase 1: Data Foundation
- Set up GarminDB, run initial sync, verify data exists
- Bun project with `bun:sqlite` queries against Garmin data
- CLI test: can you query your runs, sleep, etc?

### Phase 2: LLM + Tool Loop
- Gemini client with function calling
- Tool registry and executor
- CLI test harness (no Telegram yet, just stdin/stdout)
- Verify: does it call the right tools? Does the loop work?

### Phase 3: Memory Layer
- Docker Compose with Mem0 + Qdrant
- Memory tools wired up
- Bootstrap flow (first conversation)
- Test: save something, retrieve it later

### Phase 4: Telegram Integration
- grammY bot, message handler
- Sync-on-message pattern
- Error handling and timeouts
- End-to-end test in real Telegram

### Phase 5: Tuning
- Refine prompts based on real usage
- Add tools as patterns emerge
- Optional: proactive check-ins, food photo support

## File Structure

```
kettl/
├── src/
│   ├── index.ts           # Entry point, Telegram bot setup
│   ├── agent.ts           # Gemini client, tool calling loop
│   ├── tools/
│   │   ├── index.ts       # Tool registry, executor
│   │   ├── garmin.ts      # Garmin queries + sync wrapper
│   │   └── memory.ts      # Mem0 client
│   ├── prompts.ts         # System prompts (bootstrap, main)
│   └── config.ts          # Env vars, constants
├── Dockerfile             # Kettl container (Bun)
├── docker-compose.yml     # Kettl + Mem0 + Qdrant
├── .env                   # Secrets (not committed)
└── package.json           # Just grammy + @google/generative-ai
```

## Deployment

```bash
# Initial setup
garmindb_cli.py --all --download --import --analyze

# Run everything
docker compose up -d

# Cron for backup sync (on host)
*/10 * * * * garmindb_cli.py --all --download --import --analyze
```

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Built-in SQLite, native TS, fast, minimal config |
| Telegram | grammY | Lightweight, good DX |
| LLM | Gemini | Good function calling, cheap, swappable later |
| Garmin Data | GarminDB | Mature, syncs full history to SQLite |
| Memory | Mem0 + Qdrant | Smart extraction, self-hosted |
| Database | SQLite (bun:sqlite) | GarminDB already uses it, zero setup |

## Constraints

- Self-hosted via Docker Compose
- Budget: ~$30/month target
- Single user only
