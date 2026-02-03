# Health Coach Bot

A self-hosted, AI-powered health coaching assistant that connects to Garmin data and maintains intelligent long-term memory.

## Goals

- Chat-based interface (Telegram) for logging food, feelings, workouts, and getting coaching
- Access to full Garmin history (runs, sleep, weight, stress, body battery, etc.)
- Smart memory that retains patterns and goals, not noise
- BYOK model support (starting with Gemini, swappable later)
- Fully self-hosted, no third-party data storage
- Minimal dependencies, minimal config ceremony

## Non-Goals

- Fancy dashboard or visualizations
- Multi-user support (just me)
- Mobile app
- Real-time watch sync (Garmin Connect is the source of truth)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Bun TypeScript App                 │
│                                                 │
│   Telegram ←→ Gemini (with tool calling)       │
│                   ↓                             │
│              Tool executor                      │
│         ↙        ↓         ↘                   │
│   GarminDB    Mem0 API    GarminDB             │
│   (SQLite)    (memories)   CLI (sync)          │
└─────────────────────────────────────────────────┘
         │           │
         │           ▼
         │    ┌─────────────┐
         │    │ Mem0 + Qdrant│
         │    │  (Docker)    │
         │    └─────────────┘
         ▼
   ~/.garmindb/
   garmin.db (SQLite)
```

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Built-in SQLite, native TS, fast, minimal config |
| Telegram | grammY | Lightweight, good DX |
| LLM | Gemini | Good function calling, multimodal for future food pics |
| Garmin Data | GarminDB | Mature, syncs full history to SQLite |
| Memory | Mem0 + Qdrant | Smart extraction, categories, self-hosted |
| Database | SQLite (bun:sqlite) | GarminDB already uses it, zero setup |

### Dependencies

```json
{
  "dependencies": {
    "grammy": "^1.x",
    "@google/generative-ai": "^0.x"
  }
}
```

That's it. No tsconfig, no bundler, no test framework config.

---

## Data Flow

### On Every Message

1. User sends message to Telegram bot
2. Trigger GarminDB incremental sync (fast, ~2-3s if nothing new)
3. Pass message to Gemini with tool definitions
4. Gemini decides what tools to call (if any)
5. Execute tool calls, return results to Gemini
6. Gemini formulates response
7. Send response to user
8. Gemini may call `save_insight` to persist important learnings

### Sync Strategy

- **Primary:** Sync on every incoming message (incremental is fast)
- **Background:** Cron every 10 minutes as safety net
- **On-demand:** `sync_garmin` tool for explicit refresh

---

## Tools (Gemini Function Calling)

### Garmin Tools

| Tool | Params | Description |
|------|--------|-------------|
| `sync_garmin` | none | Force refresh from Garmin Connect. Use when data might be stale or user just completed activity. |
| `get_todays_summary` | none | Today's steps, sleep score, stress avg, body battery, resting HR |
| `get_recent_runs` | `days: number` | Run activities with date, distance, duration, avg HR, avg pace |
| `get_run_details` | `activity_id: string` | Detailed breakdown: HR zones, pace splits, cadence |
| `get_sleep_trend` | `days: number` | Sleep duration, scores, deep/light/REM breakdown |
| `get_weight_trend` | `days: number` | Weight measurements over time |
| `get_heart_rate_trend` | `days: number` | Resting HR trend |
| `get_body_battery_trend` | `days: number` | Body battery patterns |
| `query_garmin` | `sql: string` | Escape hatch for complex queries (use sparingly) |

### Memory Tools

| Tool | Params | Description |
|------|--------|-------------|
| `search_memories` | `query: string` | Find relevant past context, goals, patterns |
| `save_insight` | `category: string, content: string` | Persist important learning for future |
| `get_user_profile` | none | Retrieve core user goals and preferences |

### Memory Categories

- `user_profile` - Goals, preferences, coaching style, constraints
- `goals` - Specific targets (weight, race times, habits)
- `food_impacts` - How foods affect sleep/performance/energy
- `training_patterns` - What works, what doesn't, injury patterns
- `weekly_summaries` - Periodic rollups of progress

---

## System Prompts

### Bootstrap (First Conversation)

```
You're starting fresh with a new user who wants health/fitness coaching.

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

Be conversational, not a form. Build rapport.
```

### Main (Ongoing Conversations)

```
You're a personal health coach with access to the user's Garmin data and conversation history.

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

Don't over-explain. Don't be sycophantic. Be a good coach.
```

---

## File Structure

```
/
├── src/
│   ├── index.ts              # Entry, Telegram bot setup
│   ├── agent.ts              # Gemini client, tool loop
│   ├── tools/
│   │   ├── garmin.ts         # All Garmin queries + sync
│   │   ├── memory.ts         # Mem0 client wrapper
│   │   └── index.ts          # Tool registry + executor
│   └── prompts.ts            # System prompts
├── docker-compose.yml        # Mem0 + Qdrant
├── .env                      # TELEGRAM_TOKEN, GEMINI_API_KEY, etc.
└── package.json
```

---

## Implementation Phases

### Phase 1: Data Foundation
- [ ] GarminDB initial sync, verify data in SQLite
- [ ] Bun project scaffold
- [ ] Curated query functions with `bun:sqlite`
- [ ] Shell wrapper for GarminDB CLI sync
- [ ] Test queries against real data

### Phase 2: Gemini + Tool Loop
- [ ] Gemini client with function calling
- [ ] Tool definition schema
- [ ] Agentic loop (call → execute → return → repeat)
- [ ] Basic CLI test harness (before Telegram)

### Phase 3: Memory Layer
- [ ] Docker compose for Mem0 + Qdrant
- [ ] Memory tools (search, save, get_profile)
- [ ] Category configuration
- [ ] Retention/priority rules
- [ ] Bootstrap flow for new user

### Phase 4: Telegram Integration
- [ ] grammY bot setup
- [ ] Message handler with sync-first pattern
- [ ] Error handling and timeouts
- [ ] Test end-to-end flow

### Phase 5: Tuning & Polish
- [ ] Refine system prompts based on real usage
- [ ] Adjust tool descriptions for better Gemini choices
- [ ] Add more curated queries as patterns emerge
- [ ] Optional: proactive check-ins (scheduled messages)
- [ ] Optional: image support for food logging

---

## Infrastructure

### Docker Compose

```yaml
services:
  mem0:
    image: mem0ai/mem0:latest
    ports:
      - "8080:8080"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}  # or configure for other LLMs
    depends_on:
      - qdrant

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  qdrant_data:
```

### Cron (Backup Sync)

```cron
*/10 * * * * cd /path/to/garmindb && garmindb_cli.py --all --download --import --analyze
```

### Environment Variables

```env
TELEGRAM_BOT_TOKEN=
GEMINI_API_KEY=
MEM0_URL=http://localhost:8080
GARMINDB_PATH=~/.garmindb/garmin.db
GARMIN_EMAIL=
GARMIN_PASSWORD=
```

---

## Open Questions

- [ ] Mem0 LLM backend: use Gemini or separate smaller model for extraction?
- [ ] How aggressive on memory saving? Start conservative, tune up?
- [ ] Weekly summary generation: proactive or on-demand?
- [ ] Food logging: text only or add image recognition later?

---

## Success Criteria

- Can ask "how did I sleep this week?" and get accurate data
- Can say "just finished a run" and it syncs + analyzes without prompting
- Remembers my goals from weeks ago without me repeating
- Notices patterns I haven't explicitly stated ("your runs suffer after late meals")
- Feels like talking to a coach, not a database query tool