<p align="center">
  <img src="kettl.png" alt="Kettl" width="200">
</p>

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

Create a folder and add two files:

**docker-compose.yml**
```yaml
services:
  kettl:
    image: ghcr.io/techtonic-org/kettl:latest
    env_file: .env
    environment:
      - TZ=${TZ:-UTC}
    volumes:
      - ./data/garmindb:/root/.GarminDb
      - ./data/healthdata:/root/HealthData
      - ./data/summaries:/app/data/summaries
      - ./data/chats:/app/data/chats
      - ./data/sessions:/app/data/sessions
      - ./data/withings:/app/data/withings
    depends_on:
      - mem0
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:latest
    volumes:
      - ./data/qdrant:/qdrant/storage
    restart: unless-stopped

  mem0:
    image: ghcr.io/techtonic-org/kettl-mem0:latest
    environment:
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - OPENAI_API_KEY=${GEMINI_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    depends_on:
      - qdrant
    restart: unless-stopped
```

**.env**
```bash
GARMIN_EMAIL=your-garmin-email
GARMIN_PASSWORD=your-garmin-password
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
GEMINI_API_KEY=your-gemini-api-key

# Optional
TZ=Europe/London
GARMIN_START_DATE=2024-01-01
GARMIN_ACTIVITY_COUNT=200
```

Then run:
```bash
docker compose up -d
```

Message your bot on Telegram. That's it.

> **Note**: First startup takes several minutes while Garmin data syncs. Subsequent starts are fast (~10-30 seconds).

## Requirements

- Docker and Docker Compose
- Garmin Connect account with health data
- Telegram bot token ([create with @BotFather](https://t.me/botfather))
- Gemini API key ([get from Google AI Studio](https://aistudio.google.com/apikey))

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GARMIN_EMAIL` | Yes | - | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Yes | - | Your Garmin Connect password |
| `TELEGRAM_BOT_TOKEN` | Yes | - | From @BotFather |
| `GEMINI_API_KEY` | Yes | - | From Google AI Studio |
| `TZ` | No | UTC | Your timezone ([list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)) |
| `GARMIN_START_DATE` | No | 6 months ago | How far back to sync metrics (YYYY-MM-DD) |
| `GARMIN_ACTIVITY_COUNT` | No | 200 | Number of activities to download |
| `WITHINGS_CLIENT_ID` | No | - | Withings API client ID (for body composition) |
| `WITHINGS_CLIENT_SECRET` | No | - | Withings API client secret |
| `WITHINGS_CALLBACK_URL` | No | `http://localhost:3000/callback` | OAuth callback URL |
| `WITHINGS_TOKENS_PATH` | No | `./data/withings/tokens.json` | Token storage path |

### Garmin Sync Details

The sync uses [GarminDB](https://github.com/tcgoetz/GarminDb) which has two modes:

- **Metrics** (`GARMIN_START_DATE`): Sleep, HR, steps, stress, body battery - syncs by date range
- **Activities** (`GARMIN_ACTIVITY_COUNT`): Runs, walks, rides - syncs last N activities (not by date)

First sync: 1-2 minutes per month of data. Subsequent syncs: ~10-30 seconds.

### Withings Body Composition (Optional)

If you have a Withings scale, Kettl can pull weight, body fat %, muscle mass, bone mass, water %, and BMI.

**1. Create a Withings Developer App**

Go to https://developer.withings.com/dashboard/, create an app, and set the callback URL to `http://localhost:3000/callback`.

**2. Add to .env**

```bash
WITHINGS_CLIENT_ID=your_client_id
WITHINGS_CLIENT_SECRET=your_client_secret
```

**3. Run the OAuth setup**

```bash
bun run withings:setup
# Or in Docker:
docker compose exec kettl bun run withings:setup
```

Open the printed URL in your browser and authorize the app. Tokens are saved automatically.

**Running on a headless server?** The setup prints an auth URL. Open it on your local machine, authorize, then when redirected to `localhost:3000/callback?code=...`, exchange the code manually within 30 seconds:

```bash
curl -s -X POST "https://wbsapi.withings.net/v2/oauth2" \
  -d "action=requesttoken" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=CODE_FROM_URL" \
  -d "redirect_uri=http://localhost:3000/callback"
```

Save the response to `data/withings/tokens.json`:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": <current_unix_timestamp + expires_in>
}
```

Access tokens expire after 3 hours. Kettl refreshes them automatically.

## Data Storage

All data lives under `./data/`:

```
./data/
├── garmindb/     # GarminDB databases
├── healthdata/   # Garmin exports
├── qdrant/       # Vector storage (memories)
├── summaries/    # Daily summary cache
├── chats/        # Chat history
├── sessions/     # Session state
└── withings/     # Withings OAuth tokens
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
   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐
   │  Mem0   │───→│ Qdrant  │    │ Garmin  │    │ Withings │
   │  (API)  │    │(Vectors)│    │(SQLite) │    │  (API)   │
   └─────────┘    └─────────┘    └─────────┘    └──────────┘
```

Three containers:
- **kettl**: The bot (Bun + TypeScript, Python for GarminDB)
- **mem0**: Memory extraction and retrieval service
- **qdrant**: Vector database for semantic memory search

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

Want to contribute? Clone the repo and set up for development:

```bash
git clone https://github.com/techtonic-org/kettl.git
cd kettl

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
pip install garmindb

# Run services + local code
docker compose up -d qdrant mem0
bun run start

# Or build and run everything in Docker
docker compose up --build -d
```

Run tests with `bun test`. CLI mode (no Telegram): `bun run cli`.

Pull requests welcome!

## License

MIT - see [LICENSE](LICENSE)
