# Kettl Open Source Release Design

## Overview

Prepare kettl for public release as a self-hosted Telegram health coaching bot. Users should be able to clone the repo, configure `.env`, and run `docker compose up` to get a working system.

## Decisions Made

- **Container registry:** GitHub Container Registry (ghcr.io)
- **License:** MIT
- **Target audience:** Developer-friendly (assumes Docker knowledge)
- **Data structure:** All persistent data under `./data/` for easy backup/migration
- **Multi-arch:** Build for amd64 + arm64

---

## 1. Repository Setup

### Branch Protection (GitHub Settings)

- Protect `main` branch
- Require pull request before merging
- Require CI to pass before merge (once CI exists)

### New Files

| File | Purpose |
|------|---------|
| `LICENSE` | MIT license text |
| `.github/workflows/docker-publish.yml` | CI pipeline |
| `docs/MIGRATION.md` | Personal data migration checklist |
| `docs/CONTRIBUTING.md` | Contribution guidelines (optional) |

### Files to Update

| File | Changes |
|------|---------|
| `README.md` | Complete rewrite |
| `.env.example` | Review completeness, add descriptions |
| `docker-compose.yml` | Consolidated data paths, TZ from env |

### Pre-release Cleanup

- Verify `.env` is gitignored and never committed
- Check git history for accidentally committed secrets
- Remove/generalize personal references

---

## 2. CI/CD Pipeline

### Trigger Events

- Push to `main` branch (after PR merge)
- Git tags matching `v*` (e.g., `v1.0.0`)

### Images Built

1. `ghcr.io/<user>/kettl` - Main app
2. `ghcr.io/<user>/kettl-mem0` - Memory service

### Tag Strategy

| Tag | When |
|-----|------|
| `latest` | Every push to main |
| `v1.0.0` | Git tag push |
| `sha-abc1234` | Every build (for debugging) |

### Workflow Steps

1. Checkout code
2. Set up Docker Buildx
3. Set up QEMU (for multi-arch)
4. Login to ghcr.io using `GITHUB_TOKEN`
5. Build and push `kettl` (amd64 + arm64)
6. Build and push `kettl-mem0` (amd64 + arm64)

### Not Included

- Test execution (would require Garmin credentials and external services)
- Can add later with mocked dependencies

---

## 3. README Structure

### Opening Pitch

Weave together four angles:
- **Privacy:** Your Garmin data stays on your server
- **Cost:** $1-2/month in API credits vs expensive coaching apps
- **Technical:** Built with Bun, Gemini, Qdrant/Mem0
- **Personal:** Brief "why I built this"

### Sections

1. **Features**
   - Pattern spotting ("Your pace drops 15 sec/km when you sleep under 6.5 hours")
   - Accountability tracking
   - Daily summaries
   - Friction-free logging
   - Multi-day trend analysis

2. **Quick Start**
   ```bash
   git clone https://github.com/<user>/kettl
   cd kettl
   cp .env.example .env
   # Edit .env with your credentials
   docker compose up -d
   ```

3. **Configuration**
   - Table of all env vars with descriptions
   - Required vs optional clearly marked

4. **Architecture**
   - Brief diagram: Telegram -> kettl -> Gemini API
   - kettl -> mem0 -> qdrant for memory
   - kettl -> GarminDB for health data

5. **Initial Sync Warning**
   - First startup takes several minutes (Garmin sync)
   - Subsequent starts are fast

6. **Development**
   - Running locally with `bun`
   - Running tests with `bun test`

7. **Contributing**
   - Link to CONTRIBUTING.md or brief inline

8. **License**
   - MIT

---

## 4. Consolidated Data Structure

### New Layout

```
./data/
├── garmindb/        # GarminDB databases (~/.GarminDb equivalent)
├── healthdata/      # Garmin exports (~/HealthData equivalent)
├── qdrant/          # Vector storage (replaces Docker volume)
├── summaries/       # Daily summary JSONs
├── chats/           # Chat history JSONs
└── sessions/        # Session state JSONs
```

### Updated docker-compose.yml

```yaml
services:
  kettl:
    image: ghcr.io/<user>/kettl:latest
    # or build: . for local development
    env_file: .env
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
    image: ghcr.io/<user>/kettl-mem0:latest
    # or build: -f mem0.Dockerfile .
    environment:
      - OPENAI_API_KEY=${GEMINI_API_KEY}
      - QDRANT_HOST=qdrant
    depends_on:
      - qdrant
    restart: unless-stopped
```

### Benefits

- Single folder to backup/migrate
- No Docker volumes to manage
- Clear separation of concerns
- Easy to understand what's persistent

---

## 5. Data Migration (Personal Reference)

### What to Migrate

| Data | Source Location | Destination |
|------|-----------------|-------------|
| GarminDB | `~/.GarminDb/` | `./data/garmindb/` |
| Health data | `~/HealthData/` | `./data/healthdata/` |
| Summaries | `./data/summaries/` | `./data/summaries/` |
| Chats | `./data/chats/` | `./data/chats/` |
| Sessions | `./data/sessions/` | `./data/sessions/` |
| Qdrant | Docker volume `qdrant_data` | `./data/qdrant/` |

### Steps

1. **Stop services on dev machine:**
   ```bash
   docker compose down
   ```

2. **Export Qdrant volume:**
   ```bash
   docker run --rm \
     -v qdrant_data:/data \
     -v /mnt/temp:/backup \
     alpine tar czf /backup/kettl-qdrant.tar.gz -C /data .
   ```

3. **Copy to NAS:**
   ```bash
   mkdir -p /mnt/temp/kettl-migration
   cp -r ~/.GarminDb /mnt/temp/kettl-migration/garmindb
   cp -r ~/HealthData /mnt/temp/kettl-migration/healthdata
   cp -r ./data/summaries /mnt/temp/kettl-migration/
   cp -r ./data/chats /mnt/temp/kettl-migration/
   cp -r ./data/sessions /mnt/temp/kettl-migration/
   # qdrant tarball already at /mnt/temp/kettl-qdrant.tar.gz
   ```

4. **On target server - set up:**
   ```bash
   git clone https://github.com/<user>/kettl
   cd kettl
   mkdir -p data/{garmindb,healthdata,qdrant,summaries,chats,sessions}
   ```

5. **Copy from NAS:**
   ```bash
   cp -r /mnt/temp/kettl-migration/garmindb/* ./data/garmindb/
   cp -r /mnt/temp/kettl-migration/healthdata/* ./data/healthdata/
   cp -r /mnt/temp/kettl-migration/summaries/* ./data/summaries/
   cp -r /mnt/temp/kettl-migration/chats/* ./data/chats/
   cp -r /mnt/temp/kettl-migration/sessions/* ./data/sessions/
   tar xzf /mnt/temp/kettl-qdrant.tar.gz -C ./data/qdrant/
   ```

6. **Configure and start:**
   ```bash
   cp .env.example .env
   # Edit .env with credentials
   docker compose up -d
   ```

---

## 6. Implementation Order

1. **Cleanup & verify** - Check git history for secrets
2. **Add LICENSE** - MIT
3. **Update docker-compose.yml** - Consolidated data paths
4. **Update .env.example** - Complete with descriptions
5. **Create CI workflow** - docker-publish.yml
6. **Rewrite README.md** - Full documentation
7. **Create docs/MIGRATION.md** - Personal migration checklist
8. **Protect main branch** - GitHub settings
9. **Tag v1.0.0** - First public release
10. **Verify** - Clone fresh, follow README, confirm it works

---

## Open Questions

None - ready for implementation.
