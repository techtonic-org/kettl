# Kettl

A self-hosted Telegram health coaching bot. Connects your Garmin data with an LLM that remembers your goals, spots patterns, and holds you accountable.

## Why Kettl?

- **Privacy**: Your health data stays on your server. No third-party cloud services touching your Garmin data.
- **Cost**: ~$1-2/month in API credits vs $10-30/month for coaching apps.
- **Intelligence**: Gemini spots patterns humans miss: "Your pace drops 15 sec/km when you sleep under 6.5 hours."
- **Memory**: Remembers your goals, preferences, and history across conversations.

## What It Does

- **Pattern Spotter**: "You've had 3 hard runs in a row - your body battery is down 20% from last week"
- **Accountability**: "You said you'd rest after hard runs - yesterday was hard, how are you feeling?"
- **Daily Summaries**: Morning briefing with sleep, recovery, and what's ahead
- **Friction-free Logging**: Say "had pizza at 11pm" and it correlates with tomorrow's sleep
- **Multi-day Analysis**: Trend detection across sleep, activity, stress, and body battery

## Quick Start

```bash
git clone https://github.com/techtonic-org/kettl.git
cd kettl
cp .env.example .env
# Edit .env with your credentials (see Configuration below)
docker compose up -d
```

Message your bot on Telegram. That's it.

> **Note**: First startup takes several minutes while Garmin data syncs. Subsequent starts are fast (~10-30 seconds).

## Requirements

- Docker and Docker Compose
- Garmin Connect account with health data
- Telegram bot token ([create one with @BotFather](https://t.me/botfather))
- Gemini API key ([get one from Google AI Studio](https://aistudio.google.com/apikey))

## Configuration

Copy `.env.example` to `.env` and configure:

### Required

| Variable | Description |
|----------|-------------|
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `GEMINI_API_KEY` | From Google AI Studio |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `GARMIN_START_DATE` | 6 months ago | How far back to sync metrics (YYYY-MM-DD) |
| `GARMIN_ACTIVITY_COUNT` | 200 | Number of activities to download |
| `TZ` | UTC | Your timezone ([list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)) |

### Garmin Sync Details

The sync uses [GarminDB](https://github.com/tcgoetz/GarminDb) which has two modes:

- **Metrics** (`GARMIN_START_DATE`): Sleep, HR, steps, stress, body battery - syncs by date range
- **Activities** (`GARMIN_ACTIVITY_COUNT`): Runs, walks, rides - syncs last N activities (not by date)

First sync: 1-2 minutes per month of data. Subsequent syncs: ~10-30 seconds.

## Data Storage

All data lives under `./data/`:

```
./data/
├── garmindb/     # GarminDB databases
├── healthdata/   # Garmin exports
├── qdrant/       # Vector storage (memories)
├── summaries/    # Daily summary cache
├── chats/        # Chat history
└── sessions/     # Session state
```

Back up this single folder to preserve everything.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Kettl (Bun/TS)                    │
│   Telegram Bot ←→ Gemini API ←→ Tool Executor      │
└─────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐
   │  Mem0   │───→│ Qdrant  │    │ Garmin  │
   │  (API)  │    │(Vectors)│    │(SQLite) │
   └─────────┘    └─────────┘    └─────────┘
```

Three containers:
- **kettl**: The bot (Bun + TypeScript, Python for GarminDB)
- **mem0**: Memory extraction and retrieval service
- **qdrant**: Vector database for semantic memory search

## Development

### Run Locally

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Python dependencies (for GarminDB)
pip install garmindb

# Install JS dependencies
bun install

# Run with local services
docker compose up -d qdrant mem0
bun run start
```

### CLI Test Mode

Test without Telegram:

```bash
bun run cli
```

### Run Tests

```bash
bun test
```

### Local Docker Build

Edit `docker-compose.yml` to use local builds:

```yaml
services:
  kettl:
    # image: ghcr.io/techtonic-org/kettl:latest
    build: .
```

Then:

```bash
docker compose up --build -d
```

## Logs & Debugging

```bash
# Follow logs
docker compose logs -f kettl

# Check specific container
docker compose logs mem0

# Restart after config changes
docker compose restart kettl
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `bun test`
5. Submit a pull request

## License

MIT - see [LICENSE](LICENSE)
