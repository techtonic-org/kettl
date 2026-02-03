# Kettl

A self-hosted health coaching bot. Connects your Garmin data with an LLM that remembers your goals, spots patterns, and holds you accountable.

Lives in Telegram. Syncs fresh Garmin data on every message. Remembers context across conversations.

## What it does

- **Pattern spotter**: "Your pace drops 15 sec/km when you sleep under 6.5 hours"
- **Accountability**: "You said you'd rest after hard runs - yesterday was hard, how are you feeling?"
- **Friction-free logging**: Say "had pizza at 11pm" and it files that away, correlates with tomorrow's sleep

## Requirements

- Docker + Docker Compose
- Garmin Connect account
- Telegram bot token (from [@BotFather](https://t.me/botfather))
- Gemini API key (from [Google AI Studio](https://aistudio.google.com/apikey))

## Setup

```bash
# Clone
git clone https://github.com/techtonic-org/kettl.git
cd kettl

# Configure
cp .env.example .env
# Edit .env with your credentials
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `GARMIN_START_DATE` | How far back to sync metrics (default: 6 months ago) |
| `GARMIN_ACTIVITY_COUNT` | Number of activities to download (default: 200) |
| `TELEGRAM_BOT_TOKEN` | From BotFather |
| `GEMINI_API_KEY` | From Google AI Studio |
| `MEM0_URL` | Memory service URL (default: `http://mem0:8080`) |
| `GARMINDB_PATH` | Where Garmin databases live (default: `~/.GarminDb/HealthData`) |

The app auto-generates the GarminDB config file from your email/password on first run. No manual setup needed.

### Garmin sync configuration

The Garmin sync uses [GarminDB](https://github.com/tcgoetz/GarminDb) under the hood, which has two different sync modes:

**Date-based metrics** (`GARMIN_START_DATE`):
- Controls: sleep, heart rate, weight, body battery, stress, steps, monitoring data
- Format: `YYYY-MM-DD` (e.g., `2024-06-01`)
- Default: 6 months ago from first startup
- Syncs ALL data from that date to today

**Activity count** (`GARMIN_ACTIVITY_COUNT`):
- Controls: activities (runs, walks, rides, workouts, etc.)
- This is NOT date-based - it downloads the **last N activities regardless of date**
- Default: 200
- If you have 500 activities and set this to 200, you only get the most recent 200

**Why the difference?** This is a GarminDB limitation, not a Kettl design choice. The Garmin Connect API exposes metrics by date range but activities by count.

**Recommendations:**
- For a new setup with 6 months of history: `GARMIN_START_DATE=2024-08-01` and `GARMIN_ACTIVITY_COUNT=200`
- For years of history: Set `GARMIN_ACTIVITY_COUNT` high enough to capture all activities (e.g., `1000` for ~3 years of regular training)
- First sync downloads everything and can take a while (1-2 min per month of data)
- Subsequent syncs only fetch new data and are fast (~10-30 seconds)

**Changing these after first run:**
If you change `GARMIN_START_DATE` or `GARMIN_ACTIVITY_COUNT`, you need to delete the generated config for it to take effect:
```bash
rm ~/.GarminDb/GarminConnectConfig.json
docker compose restart kettl
```

## Run

```bash
docker compose up --build -d
```

That's it. Message your bot on Telegram.

### Check logs

```bash
docker compose logs -f kettl
```

### Stop

```bash
docker compose down
```

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
   Cloud       Compose                   syncs to local SQLite
```

Three containers:
- **kettl**: The bot (Bun + Python for GarminDB)
- **mem0**: Memory extraction and retrieval
- **qdrant**: Vector storage for memories

## Tools available to the LLM

### Garmin tools
| Tool | What it does |
|------|--------------|
| `sync_garmin` | Force refresh from Garmin Connect |
| `get_todays_summary` | Steps, sleep score, stress, body battery, resting HR |
| `get_recent_activities` | Runs/walks/rides with distance, duration, HR, pace |
| `get_activity_details` | Deep dive into a specific activity |
| `get_sleep_trend` | Sleep duration and quality over N days |
| `get_weight_trend` | Weight over N days |
| `get_body_battery_trend` | Energy patterns over N days |
| `query_garmin` | Raw SQL for edge cases |

### Memory tools
| Tool | What it does |
|------|--------------|
| `search_memories` | Find relevant past context |
| `save_insight` | Store something important |
| `get_user_profile` | Load user's goals and preferences |

## Development

### Run locally (without Docker)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Python dependencies (for GarminDB)
pip install garmindb

# Install JS dependencies
bun install

# Run the bot
bun run start

# Or use the CLI test harness (no Telegram needed)
bun run cli
```

### Project structure

```
src/
├── index.ts           # Entry point
├── config.ts          # Environment config
├── prompts.ts         # System prompts
├── cli.ts             # CLI test harness
├── agent/
│   ├── gemini.ts      # Gemini API client
│   └── loop.ts        # Agentic tool loop
├── garmin/
│   ├── queries.ts     # SQLite queries
│   └── sync.ts        # Sync wrapper + config generation
├── memory/
│   └── client.ts      # Mem0 API client
├── telegram/
│   └── bot.ts         # Telegram handler
├── tools/
│   ├── registry.ts    # Tool registration
│   ├── garmin.ts      # Garmin tool definitions
│   └── memory.ts      # Memory tool definitions
└── types/
    ├── garmin.ts
    ├── tools.ts
    └── memory.ts
```

## Backup sync

The bot syncs on every message, but you can set up a cron job as backup:

```bash
# Every 10 minutes
*/10 * * * * /path/to/kettl/scripts/sync-garmin.sh
```

## Timeouts

| Operation | Timeout |
|-----------|---------|
| Garmin sync | 30s |
| Gemini API | 60s |
| Overall message handling | 90s |

If something fails, the bot tells you and continues with cached data.

## Cost

- Telegram: Free
- Gemini: ~$5-15/month at moderate usage
- Self-hosted: Whatever your server costs

## License

MIT
