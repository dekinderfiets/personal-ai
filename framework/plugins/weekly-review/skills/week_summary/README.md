# Week Summary

Generate a comprehensive weekly summary covering all activity across all connectors.

## Purpose

Produces a detailed report of everything that happened during the week: meetings attended, tasks worked on, emails exchanged, documents modified, code activity, and conversations had.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `week_start` | Yes | Start of the week (ISO 8601) |
| `week_end` | Yes | End of the week (ISO 8601) |

## Outputs

- Detailed weekly summary with per-source activity reports

## Instructions

### Step 1: Get Date Range

Use the `time` tool to confirm the current date. If `week_start` / `week_end` not provided:
- Default `week_start`: Most recent Sunday at 00:00 UTC
- Default `week_end`: Current date/time

### Step 2: Query All Sources

Make all queries in parallel for maximum efficiency.

**Calendar — Meetings attended:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "meetings events attended",
    "sources": ["calendar"],
    "searchType": "keyword",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 50
  }'
```

**Jira — Task activity:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "updated resolved completed created in progress",
    "sources": ["jira"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 50
  }'
```

**Slack — Conversations:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "messages discussions threads",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 30
  }'
```

**Gmail — Emails:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "emails threads received sent",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 30
  }'
```

**Drive & Confluence — Documents:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "documents pages created modified",
    "sources": ["drive", "confluence"],
    "searchType": "hybrid",
    "startDate": "<week_start>",
    "endDate": "<week_end>",
    "limit": 20
  }'
```

### Step 3: Compile Metrics

Calculate summary metrics:

| Metric | Calculation |
|--------|-------------|
| Meetings attended | Count of calendar events |
| Tasks worked on | Count of unique Jira issues updated |
| Tasks completed | Count of Jira issues moved to Done/Resolved |
| Emails processed | Count of email threads |
| Documents modified | Count of Drive/Confluence docs |
| Slack conversations | Count of unique channels/threads |

### Step 4: Generate Day-by-Day Breakdown

Group activity by day of the week:
- For each day, list the key activities (meetings, tasks worked, messages sent)
- Identify the busiest and quietest days

### Step 5: Identify Themes

Analyze the week's activity for common themes:
- What projects got the most attention?
- Were there any recurring topics in meetings and messages?
- What was the split between deep work vs communication?

### Step 6: Format Output

```markdown
## 📊 Week at a Glance
| Metric | Count |
|--------|-------|
| Meetings | 12 |
| Tasks Completed | 5 |
| Tasks In Progress | 3 |
| Emails | 23 |
| Documents Modified | 3 |

## 📅 Day-by-Day

### Monday, Feb 3
- 09:00 Daily Standup
- Worked on [PROJ-42] Fix login bug (In Progress → Done)
- 14:00 Sprint Planning

### Tuesday, Feb 4
- 09:00 Daily Standup
- Active in #engineering (API design discussion)
- Responded to 5 emails

[... continue for each day ...]

## 🎯 Focus Areas
1. **Authentication System** (50% of effort) — Completed login fix, security improvements
2. **API Design** (30%) — Sprint planning, Slack discussions, design doc updates
3. **Communication** (20%) — Email responses, Slack threads

## 📈 Trends
- Busiest day: Wednesday (5 meetings, 8 task updates)
- Quietest day: Friday (2 meetings, focused work)
- Most active source: Jira (15 updates)
```
