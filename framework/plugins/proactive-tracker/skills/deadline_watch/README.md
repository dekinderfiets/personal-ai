# Deadline Watch

Track approaching deadlines from calendar events, Jira due dates, and mentioned dates across all sources.

## Purpose

Scans connectors for items with upcoming deadlines or due dates. Creates a unified timeline of what's coming up so nothing gets missed.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `horizon_days` | No | How far ahead to look (default: 7) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Timeline of upcoming deadlines and due dates, sorted by urgency

## Instructions

### Step 1: Get Current Time

Use the `time` tool. Calculate:
- `today_start`: Start of today in UTC
- `horizon_end`: Current date plus `horizon_days` (default: 7 days from now)

### Step 2: Find Calendar Deadlines

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "deadline due date milestone review submission",
    "sources": ["calendar"],
    "searchType": "hybrid",
    "startDate": "<today_start>",
    "endDate": "<horizon_end>",
    "limit": 30
  }'
```

**Processing:**
- Extract events with deadline-related keywords in title or description
- Note: not all calendar events are deadlines — filter for events that indicate something is _due_ vs routine meetings
- For each: extract event title, date/time, description, url

### Step 3: Find Jira Due Dates

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "due date deadline sprint end assigned",
    "sources": ["jira"],
    "searchType": "hybrid",
    "limit": 25
  }'
```

**Processing:**
- Filter to open issues with approaching due dates
- Identify sprint end dates as implicit deadlines
- Separate overdue items from upcoming items
- For each: extract issue key, title, due date, assignee, status, url

### Step 4: Find Deadline Mentions in Communications

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "deadline by end of week due tomorrow friday",
    "sources": ["slack", "gmail"],
    "searchType": "hybrid",
    "startDate": "<1_week_ago>",
    "limit": 15
  }'
```

**Processing:**
- Look for messages mentioning specific dates or deadline language
- Extract mentioned dates and associate them with the context
- Be conservative — only flag items where a clear deadline is mentioned

### Step 5: Compile Timeline

Sort all items by deadline date ascending. Flag items by urgency:
- 🔴 **Overdue**: Past due date
- 🟠 **Today**: Due today
- 🟡 **Tomorrow**: Due tomorrow
- 🔵 **This week**: Due within 7 days
- ⚪ **Later**: Due after the horizon

```markdown
## 🕐 Deadline Timeline

### 🔴 Overdue
| Item | Source | Due Date | Days Late |
|------|--------|----------|-----------|
| [PROJ-42] Fix login bug | Jira | Feb 8 | 2d late |

### 🟠 Due Today
| Item | Source | Due Time |
|------|--------|----------|
| Q4 Report submission | Calendar | 5:00 PM |

### 🟡 Due Tomorrow
| Item | Source | Due Date |
|------|--------|----------|
| [PROJ-55] API migration | Jira | Feb 11 |

### 🔵 This Week
| Item | Source | Due Date |
|------|--------|----------|
| Sprint Review prep | Calendar | Feb 13 |
| Design doc feedback | Gmail | Feb 14 |

### Mentioned Deadlines (from conversations)
- "Let's finalize the API by Friday" — @alice in #backend (Feb 8)
- "Need budget approval by Feb 15" — email from manager (Feb 7)
```
