---
name: time
description: Get the current date and time. Essential for calculating relative times like "in 5 minutes" or "tomorrow at 3pm".
---

# Time Skill

Get the current date/time for calculations and scheduling.

## Usage

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ"   # UTC (ISO 8601)
date +"%Y-%m-%dT%H:%M:%S%z"     # Local time with timezone
date +"%Y-%m-%d"                 # Date only
date +"%H:%M:%S"                 # Time only
```

## Common Formats

| Format | Command | Example Output |
|--------|---------|----------------|
| ISO 8601 UTC | `date -u +"%Y-%m-%dT%H:%M:%SZ"` | `2026-02-02T22:07:00Z` |
| ISO 8601 Local | `date +"%Y-%m-%dT%H:%M:%S%z"` | `2026-02-02T00:07:00+0200` |
| Human readable | `date "+%B %d, %Y at %I:%M %p"` | `February 02, 2026 at 12:07 AM` |
| Unix timestamp | `date +%s` | `1769990820` |

## Date Arithmetic

```bash
# Add time intervals
date -v+1H    # 1 hour from now (macOS)
date -v+30M   # 30 minutes from now
date -v+1d    # Tomorrow
date -v+1w    # 1 week from now

# Linux equivalent
date -d "+1 hour"
date -d "+30 minutes"
date -d "tomorrow"
```

## Timezone Conversion

```bash
TZ="UTC" date                    # Current time in UTC
TZ="America/New_York" date       # Current time in New York
TZ="Europe/London" date          # Current time in London
```
