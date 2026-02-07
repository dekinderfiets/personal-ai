---
name: timezone
description: Convert between user timezone (Israel/Asia/Jerusalem) and UTC. Essential for plugins handling dates and times - parse input as Israel time, store in UTC, display in Israel time.
---

# Timezone Skill

Handle timezone conversion between Israel time (Asia/Jerusalem) and UTC.

## Key Principle

- **User input**: Assume Israel time (Asia/Jerusalem)
- **Storage/Processing**: Always use UTC
- **User output**: Display in Israel time

## Israel Timezone Info

| Property | Value |
|----------|-------|
| IANA Name | `Asia/Jerusalem` |
| Standard Time | IST (UTC+2) |
| Daylight Time | IDT (UTC+3) |
| DST Period | Late March → Late October |

## Usage

### Get Current Time

```bash
# Current time in Israel
TZ="Asia/Jerusalem" date +"%Y-%m-%dT%H:%M:%S%z"

# Current time in UTC
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

### Convert Israel Time → UTC (for storing)

When user says "9am", they mean 9am Israel time. Convert to UTC before storing:

```bash
# macOS: Convert Israel time to UTC
# Input: 2026-02-15T09:00:00 (Israel)
# Output: 2026-02-15T07:00:00Z (UTC, during winter IST)
TZ="UTC" date -j -f "%Y-%m-%dT%H:%M:%S" -v+0H "2026-02-15T09:00:00" +"%Y-%m-%dT%H:%M:%SZ"

# With explicit Israel timezone context
export TZ="Asia/Jerusalem"
date -u -j -f "%Y-%m-%dT%H:%M:%S" "2026-02-15T09:00:00" +"%Y-%m-%dT%H:%M:%SZ"
```

**DST-aware conversion** (recommended approach):
```bash
# Parse as Israel time, output as UTC
TZ="Asia/Jerusalem" date -j -f "%Y-%m-%dT%H:%M:%S" "2026-02-15T09:00:00" +%s | \
  xargs -I {} date -u -r {} +"%Y-%m-%dT%H:%M:%SZ"
```

### Convert UTC → Israel Time (for displaying)

When retrieving from database, convert UTC back to Israel time for user:

```bash
# macOS: Convert UTC to Israel time
# Input: 2026-02-15T07:00:00Z (UTC)
# Output: 2026-02-15T09:00:00+0200 (Israel)
TZ="Asia/Jerusalem" date -j -f "%Y-%m-%dT%H:%M:%SZ" "2026-02-15T07:00:00Z" +"%Y-%m-%dT%H:%M:%S%z"

# Human-readable format
TZ="Asia/Jerusalem" date -j -f "%Y-%m-%dT%H:%M:%SZ" "2026-02-15T07:00:00Z" +"%B %d, %Y at %I:%M %p"
```

## Quick Reference

| User Says | Israel Time | UTC (Store This) |
|-----------|-------------|------------------|
| "9am" (winter) | 09:00 IST | 07:00Z (UTC+2) |
| "9am" (summer) | 09:00 IDT | 06:00Z (UTC+3) |
| "midnight" (winter) | 00:00 IST | 22:00Z prev day |
| "midnight" (summer) | 00:00 IDT | 21:00Z prev day |

## Natural Language Parsing

When parsing relative times like "tomorrow at 9am":

1. Get current time in Israel: `TZ="Asia/Jerusalem" date`
2. Calculate the target time in Israel timezone
3. Convert to UTC for storage

```bash
# Example: "tomorrow at 9am" in Israel time
# Step 1: Get tomorrow's date in Israel
TOMORROW=$(TZ="Asia/Jerusalem" date -v+1d +"%Y-%m-%d")

# Step 2: Create full datetime in Israel time
ISRAEL_TIME="${TOMORROW}T09:00:00"

# Step 3: Convert to UTC
TZ="Asia/Jerusalem" date -j -f "%Y-%m-%dT%H:%M:%S" "$ISRAEL_TIME" +%s | \
  xargs -I {} date -u -r {} +"%Y-%m-%dT%H:%M:%SZ"
```

## Cron Times

Cron expressions in recurrence fields should use **Israel time hours**. The external workflow executing the cron will handle timezone appropriately.

| Cron | Meaning |
|------|---------|
| `0 9 * * *` | 9:00 AM Israel time daily |
| `0 7 * * 1` | 7:00 AM Israel time every Monday |
