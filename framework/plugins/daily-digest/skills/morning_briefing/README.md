# Morning Briefing

Generate a comprehensive morning briefing by querying all relevant sources for today's items.

## Purpose

Produces the core daily briefing by making targeted queries against each connector to surface today's schedule, active tasks, recent messages, and relevant documents.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `date` | No | Target date (default: today, from `time` tool) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Structured briefing data with sections per source

## Instructions

### Step 1: Get Current Date

Use the `time` tool to get today's date in ISO 8601 format. Calculate:
- `today_start`: Start of day in UTC (e.g., `2026-02-10T00:00:00Z`)
- `today_end`: End of day in UTC (e.g., `2026-02-10T23:59:59Z`)
- `yesterday_start`: Start of yesterday in UTC (for catching overnight items)

### Step 2: Query Calendar Events

Fetch today's meetings and events.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "events meetings",
    "sources": ["calendar"],
    "searchType": "keyword",
    "startDate": "<today_start>",
    "endDate": "<today_end>",
    "limit": 50
  }'
```

**Processing:**
- Sort events by `metadata.start` time ascending
- For each event, extract: title (`metadata.summary`), start time (`metadata.start`), end time (`metadata.end`), location (`metadata.location`), attendees (`metadata.attendees`), url (`metadata.url`)
- Flag events starting within the next 2 hours as "Coming Up"

### Step 3: Query Active Tasks

Fetch Jira issues and GitHub items assigned to the user.

**Jira open issues:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "assigned open in progress to do",
    "sources": ["jira"],
    "searchType": "hybrid",
    "limit": 20
  }'
```

**GitHub assigned issues and PRs:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "assigned open pull request issue",
    "sources": ["github"],
    "searchType": "hybrid",
    "where": { "state": "open" },
    "limit": 20
  }'
```

**Processing:**
- Filter Jira results to items where `metadata.is_assigned_to_me` is true or status is "In Progress" / "To Do"
- Sort by priority: Critical > High > Medium > Low
- For each task, extract: title, project/repo, status, priority, url

### Step 4: Query Recent Messages

Fetch recent Slack messages and emails from the last 24 hours.

**Slack messages:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "message mention direct",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<yesterday_start>",
    "limit": 20
  }'
```

**Gmail emails:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "inbox recent important",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<yesterday_start>",
    "limit": 20
  }'
```

**Processing:**
- Prioritize DMs and mentions over general channel messages
- Prioritize emails where user is in the `to` field over `cc`
- Sort by timestamp descending (newest first)
- For each message, extract: sender/author, subject/channel, snippet of content, url

### Step 5: Query Recent Documents

Fetch recently modified Drive and Confluence documents.

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "recently modified documents",
    "sources": ["drive", "confluence"],
    "searchType": "hybrid",
    "startDate": "<yesterday_start>",
    "limit": 10
  }'
```

**Processing:**
- Filter to documents the user owns or recently accessed
- Sort by modification time descending
- For each document, extract: title, type, last modified, url

### Step 6: Compile Briefing

Assemble all sections into the briefing structure:

```markdown
## 📅 Today's Schedule
| Time | Event | Location |
|------|-------|----------|
| 09:00-09:30 | Daily Standup | Zoom |
| 14:00-15:00 | Sprint Review | Room 3A |

## 📋 Active Tasks (X items)
- **[PROJ-42] Fix login bug** — In Progress, High priority [→ link]
- **[PROJ-38] Update API docs** — To Do, Medium priority [→ link]

## 💬 Recent Messages (X new)
- **#engineering** @alice: "Can you review the PR?" (2h ago) [→ link]
- **Email** from bob@co.com: "Q4 Report Draft" (5h ago) [→ link]

## 📄 Recent Documents
- **Sprint Planning Notes** (Confluence) — Updated 3h ago [→ link]
- **Architecture Diagram** (Drive) — Updated yesterday [→ link]
```
