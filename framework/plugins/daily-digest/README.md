# Daily Digest

Generate comprehensive daily briefings by aggregating data from all indexed personal sources.

## Purpose

Acts as a personal briefing assistant that queries the collector service across all connectors (Gmail, Calendar, Jira, Slack, Drive, Confluence) to produce a structured daily digest. Surfaces what's important, what needs attention, and what's coming up.

## Capabilities

- **Morning Briefing**: Comprehensive overview of today's schedule, pending items, and recent activity
- **Activity Summary**: Summarizes activity across all sources for any date range
- **Important Highlights**: Identifies high-priority items that need immediate attention

## Commands

| Command | Description |
|---------|-------------|
| `/daily_digest` | Generate today's daily digest. Invokes `skills/morning_briefing` and `skills/important_highlights` in parallel, then synthesizes. |
| `/yesterday` | Generate yesterday's activity summary. Invokes `skills/activity_summary` with yesterday's date range. |

## When to Use

Use this plugin when:
- User asks "What's going on today?" or "Give me a briefing"
- User wants a summary of their day or a past day
- User asks "What did I miss?" or "Catch me up"
- User requests a daily digest or morning briefing
- User asks "What happened yesterday?"

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `date` | No | Target date for the digest (default: today) |
| `date_range` | No | Start and end dates for activity summary |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Formatted Markdown digest with sections for calendar, tasks, messages, and highlights
- Priority-ordered list of items needing attention
- Activity summary with counts and key items per source

## Dependencies

- **Tools**: `collector`, `time`
- **Other Plugins**: None

---

## Instructions

### Pre-Execution

1. Read `brain/guidelines.md` for output standards
2. Read `tools/collector/TOOL.md` to understand the collector API
3. Read `tools/time/TOOL.md` to get the current date/time
4. **Get current date/time first** — this is critical for constructing all date-based queries

### Command: `/daily_digest`

Execute `skills/morning_briefing` and `skills/important_highlights` in parallel (they are independent), then combine results into a single digest.

**Output format:**

```markdown
# Daily Digest — [Day, Month Date, Year]

## 📅 Today's Schedule
[Calendar events sorted by time]

## 📋 Active Tasks
[Open Jira issues assigned to me]

## 💬 Messages Needing Response
[Unresponded Slack messages and emails]

## ⚡ Highlights & Alerts
[High-priority items from important_highlights skill]

## 📄 Recent Documents
[Recently modified Drive/Confluence docs relevant to me]
```

### Command: `/yesterday`

Execute `skills/activity_summary` with yesterday's date range.

### Standalone Use

For custom date ranges, execute `skills/activity_summary` with the specified `date_range`.

---

### Post-Execution

1. Present the digest in clean, scannable Markdown
2. Lead with the most actionable items
3. Include links (URLs) to original items where available
4. Add a brief "Quick Actions" section suggesting what to tackle first

### Error Handling

- **Collector unreachable**: Report which sources failed and show partial results from available sources
- **No results for a source**: Omit that section rather than showing empty sections
- **Stale data**: Check index status; if a source hasn't synced in >24h, note it in the digest
