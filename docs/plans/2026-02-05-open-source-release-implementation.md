# Open Source Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare kettl for public release with CI/CD, documentation, and consolidated data structure.

**Architecture:** Update docker-compose.yml to use bind mounts under `./data/` instead of scattered locations. Add GitHub Actions workflow for multi-arch Docker builds. Rewrite README with complete setup instructions.

**Tech Stack:** Docker, GitHub Actions, GitHub Container Registry (ghcr.io), Docker Buildx, QEMU

---

## Task 1: Add MIT License

**Files:**
- Create: `LICENSE`

**Step 1: Create LICENSE file**

Create `LICENSE` with MIT license text:

```text
MIT License

Copyright (c) 2024 Kettl Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

## Task 2: Update docker-compose.yml with Consolidated Data Paths

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Update docker-compose.yml**

Replace the entire file with:

```yaml
services:
  kettl:
    image: ghcr.io/techtonic-org/kettl:latest
    # For local development, comment out image and uncomment build:
    # build: .
    env_file:
      - .env
    environment:
      - TZ=${TZ:-UTC}
    volumes:
      - ./data/garmindb:/root/.GarminDb
      - ./data/healthdata:/root/HealthData
      - ./data/summaries:/app/data/summaries
      - ./data/chats:/app/data/chats
      - ./data/sessions:/app/data/sessions
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
    # For local development, comment out image and uncomment build:
    # build:
    #   context: .
    #   dockerfile: mem0.Dockerfile
    environment:
      - QDRANT_HOST=qdrant
      - QDRANT_PORT=6333
      - OPENAI_API_KEY=${GEMINI_API_KEY}
    depends_on:
      - qdrant
    restart: unless-stopped
```

**Key changes:**
- Use ghcr.io images by default (with build commented for dev)
- TZ from env with UTC default
- All data under `./data/` (garmindb, healthdata, qdrant as bind mounts)
- Removed exposed ports for qdrant and mem0 (internal only)

**Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: consolidate data paths under ./data/"
```

---

## Task 3: Update .env.example with TZ and Descriptions

**Files:**
- Modify: `.env.example`

**Step 1: Update .env.example**

Replace with comprehensive version:

```bash
# =============================================================================
# Kettl Configuration
# =============================================================================
# Copy this file to .env and fill in your values:
#   cp .env.example .env
# =============================================================================

# -----------------------------------------------------------------------------
# REQUIRED: Garmin Connect Credentials
# -----------------------------------------------------------------------------
# Your Garmin Connect login credentials
# Create account at: https://connect.garmin.com
GARMIN_EMAIL=your-email@example.com
GARMIN_PASSWORD=your-password

# -----------------------------------------------------------------------------
# REQUIRED: Telegram Bot
# -----------------------------------------------------------------------------
# Create a bot with @BotFather on Telegram: https://t.me/botfather
# Use /newbot command and copy the token
TELEGRAM_BOT_TOKEN=your-telegram-bot-token

# -----------------------------------------------------------------------------
# REQUIRED: Gemini API
# -----------------------------------------------------------------------------
# Get your API key from Google AI Studio: https://aistudio.google.com/apikey
GEMINI_API_KEY=your-gemini-api-key

# -----------------------------------------------------------------------------
# OPTIONAL: Garmin Sync Settings
# -----------------------------------------------------------------------------
# How far back to sync Garmin metrics (sleep, HR, steps, etc.)
# Format: YYYY-MM-DD
# Default: 6 months ago from first startup
# First sync can take 1-2 min per month of data
GARMIN_START_DATE=2024-01-01

# Number of activities to download (runs, walks, rides, etc.)
# NOTE: This downloads the last N activities, NOT by date
# Set high enough to capture your desired history
# Default: 200
GARMIN_ACTIVITY_COUNT=200

# -----------------------------------------------------------------------------
# OPTIONAL: Timezone
# -----------------------------------------------------------------------------
# Your local timezone for accurate daily summaries
# List: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
# Default: UTC
TZ=UTC

# -----------------------------------------------------------------------------
# INTERNAL: Service URLs (don't change unless you know what you're doing)
# -----------------------------------------------------------------------------
# Mem0 memory service URL (use container name when running with Docker Compose)
MEM0_URL=http://mem0:8080

# GarminDB database path (relative to container)
GARMINDB_PATH=/root/HealthData/DBs
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: improve .env.example with descriptions and sections"
```

---

## Task 4: Create GitHub Actions CI Workflow

**Files:**
- Create: `.github/workflows/docker-publish.yml`

**Step 1: Create workflows directory**

```bash
mkdir -p .github/workflows
```

**Step 2: Create docker-publish.yml**

Create `.github/workflows/docker-publish.yml`:

```yaml
name: Build and Publish Docker Images

on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  KETTL_IMAGE: ghcr.io/${{ github.repository }}
  MEM0_IMAGE: ghcr.io/${{ github.repository }}-mem0

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata for kettl
        id: meta-kettl
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.KETTL_IMAGE }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=sha-

      - name: Build and push kettl
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta-kettl.outputs.tags }}
          labels: ${{ steps.meta-kettl.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Extract metadata for kettl-mem0
        id: meta-mem0
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.MEM0_IMAGE }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=sha-

      - name: Build and push kettl-mem0
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./mem0.Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta-mem0.outputs.tags }}
          labels: ${{ steps.meta-mem0.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Step 3: Commit**

```bash
git add .github/workflows/docker-publish.yml
git commit -m "ci: add GitHub Actions workflow for multi-arch Docker builds"
```

---

## Task 5: Rewrite README.md

**Files:**
- Modify: `README.md`

**Step 1: Rewrite README.md**

Replace with:

```markdown
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
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for open-source release"
```

---

## Task 6: Create Migration Documentation

**Files:**
- Create: `docs/MIGRATION.md`

**Step 1: Create docs/MIGRATION.md**

```markdown
# Data Migration Guide

How to migrate kettl data from one machine to another.

## Overview

All persistent data is stored under `./data/`. To migrate:

1. Stop services on source machine
2. Copy `./data/` folder to destination
3. Start services on destination

## Prerequisites

- Access to both machines (source and destination)
- Shared storage (NAS, rsync, scp) or transfer medium

## Step-by-Step Migration

### 1. Stop Services on Source

```bash
cd /path/to/kettl
docker compose down
```

### 2. Create Backup

If your data is already under `./data/`:

```bash
tar -czf kettl-backup.tar.gz ./data/
```

If migrating from an older layout (pre-consolidated):

```bash
# Create migration folder
mkdir -p migration/data

# Copy from old locations
cp -r ~/.GarminDb migration/data/garmindb
cp -r ~/HealthData migration/data/healthdata
cp -r ./data/summaries migration/data/summaries
cp -r ./data/chats migration/data/chats
cp -r ./data/sessions migration/data/sessions

# Export Qdrant from Docker volume (if using old volume-based setup)
docker run --rm \
  -v qdrant_data:/data \
  -v $(pwd)/migration:/backup \
  alpine tar czf /backup/qdrant.tar.gz -C /data .

# Extract into data folder
mkdir -p migration/data/qdrant
tar -xzf migration/qdrant.tar.gz -C migration/data/qdrant

# Create final archive
tar -czf kettl-backup.tar.gz -C migration data
```

### 3. Transfer to Destination

Using shared NAS:
```bash
cp kettl-backup.tar.gz /mnt/nas/
```

Using rsync:
```bash
rsync -avz kettl-backup.tar.gz user@destination:/path/
```

Using scp:
```bash
scp kettl-backup.tar.gz user@destination:/path/
```

### 4. Set Up on Destination

```bash
# Clone fresh
git clone https://github.com/techtonic-org/kettl.git
cd kettl

# Extract data
tar -xzf /path/to/kettl-backup.tar.gz

# Configure
cp .env.example .env
# Edit .env with your credentials

# Start
docker compose up -d
```

### 5. Verify

```bash
# Check services are running
docker compose ps

# Check logs for errors
docker compose logs kettl

# Message your bot on Telegram to verify
```

## Troubleshooting

### Qdrant Permission Issues

If Qdrant fails to start with permission errors:

```bash
sudo chown -R 1000:1000 ./data/qdrant
```

### GarminDB Database Locked

If you see "database is locked" errors:

```bash
docker compose restart kettl
```

### Memory Service Not Connecting

Check mem0 logs:

```bash
docker compose logs mem0
```

Verify Qdrant is healthy:

```bash
curl http://localhost:6333/health
```

## Data Locations Reference

| Data | Container Path | Host Path |
|------|---------------|-----------|
| GarminDB config | `/root/.GarminDb` | `./data/garmindb` |
| Health exports | `/root/HealthData` | `./data/healthdata` |
| Vector storage | `/qdrant/storage` | `./data/qdrant` |
| Summaries | `/app/data/summaries` | `./data/summaries` |
| Chat history | `/app/data/chats` | `./data/chats` |
| Sessions | `/app/data/sessions` | `./data/sessions` |
```

**Step 2: Commit**

```bash
git add docs/MIGRATION.md
git commit -m "docs: add data migration guide"
```

---

## Task 7: Update .gitignore for Data Directory

**Files:**
- Modify: `.gitignore`

**Step 1: Update .gitignore**

Add data directory entries. Append to end of file:

```
# Persistent data (user-specific, not committed)
data/garmindb/
data/healthdata/
data/qdrant/
```

The existing entries already cover `data/summaries/`, `data/chats/`, and `data/sessions/`.

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore consolidated data directories"
```

---

## Task 8: Final Review and Push

**Step 1: Review all changes**

```bash
git log --oneline -10
```

Expected: 7 new commits (license, docker-compose, env.example, CI, README, migration, gitignore)

**Step 2: Push to origin**

```bash
git push origin main
```

**Step 3: Verify CI runs**

Check GitHub Actions: `https://github.com/techtonic-org/kettl/actions`

The workflow should trigger on push to main and build both images.

---

## Task 9: Tag v1.0.0 Release

**Note:** Only do this after CI succeeds and images are pushed.

**Step 1: Create annotated tag**

```bash
git tag -a v1.0.0 -m "First public release

- Multi-arch Docker images (amd64 + arm64)
- Consolidated data structure under ./data/
- Complete setup documentation
- MIT license"
```

**Step 2: Push tag**

```bash
git push origin v1.0.0
```

**Step 3: Verify release images**

Check that tagged images appear:
- `ghcr.io/techtonic-org/kettl:v1.0.0`
- `ghcr.io/techtonic-org/kettl-mem0:v1.0.0`

---

## Post-Implementation: GitHub Settings (Manual)

These steps require GitHub web UI:

1. Go to repository Settings → Branches
2. Add branch protection rule for `main`:
   - Require pull request before merging
   - Require status checks to pass (select the CI workflow)
3. Go to Settings → Actions → General
   - Ensure "Read and write permissions" under Workflow permissions

---

## Verification Checklist

After all tasks complete:

- [ ] LICENSE file exists with MIT text
- [ ] docker-compose.yml uses ghcr.io images and ./data/ paths
- [ ] .env.example has clear descriptions and sections
- [ ] CI workflow exists and runs on push
- [ ] README covers Quick Start, Configuration, Architecture
- [ ] docs/MIGRATION.md exists with step-by-step guide
- [ ] .gitignore covers data/* directories
- [ ] Images published to ghcr.io
- [ ] v1.0.0 tag pushed
