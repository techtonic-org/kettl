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
