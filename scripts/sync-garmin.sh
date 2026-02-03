#!/bin/bash
# Backup sync for Garmin data
# Add to cron: */10 * * * * /path/to/kettl/scripts/sync-garmin.sh

set -e
garmindb_cli.py --all --download --import --analyze 2>&1 | tail -5
