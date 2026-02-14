# Important Highlights

Identify high-priority items across all sources that need immediate attention.

## Purpose

Scans indexed data to surface critical items: overdue tasks, unanswered important emails, upcoming deadlines, and any other items that require urgent attention. Acts as an "alert system" for the daily digest.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `lookback_hours` | No | How far back to scan for items (default: 48) |
| `sources` | No | Limit to specific sources (default: all) |

## Outputs

- Priority-ordered list of items needing attention, each with a severity level and recommended action

## Instructions

### Step 1: Get Current Time

Use the `time` tool. Calculate the lookback window (default: 48 hours before now).

### Step 2: Find Overdue and High-Priority Tasks

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "overdue high priority critical blocker urgent assigned",
    "sources": ["jira"],
    "searchType": "hybrid",
    "limit": 20
  }'
```

**Processing:**
- Identify items with `metadata.priority` = "Critical" or "Highest" or "High"
- Identify items where `metadata.is_assigned_to_me` is true
- Flag items with `metadata.days_since_update` > 7 as potentially stale
- Check for items with approaching or past due dates

### Step 3: Find Unanswered Important Emails

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "action required urgent response needed important",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<lookback_start>",
    "limit": 15
  }'
```

**Processing:**
- Prioritize emails where user is in `to` field (not just `cc`)
- Look for keywords in subject/content: "urgent", "action required", "deadline", "ASAP", "please respond"
- Flag emails with no reply in the thread (check `metadata.thread_depth`)

### Step 4: Find Upcoming Deadlines

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "deadline due date reminder",
    "sources": ["calendar", "jira"],
    "searchType": "hybrid",
    "startDate": "<today_start>",
    "endDate": "<3_days_from_now>",
    "limit": 20
  }'
```

**Processing:**
- Extract dates from calendar events (look for "deadline", "due" in title/description)
- Check Jira issues for approaching due dates
- Sort by urgency (today > tomorrow > this week)

### Step 5: Find Unresolved Slack Threads

```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "question help need response waiting",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<lookback_start>",
    "limit": 15
  }'
```

**Processing:**
- Look for messages that mention the user or are in DMs
- Identify questions directed at the user that may be unanswered

### Step 6: Compile and Prioritize Highlights

Assign each item a severity level:
- 🔴 **Critical**: Overdue tasks, missed deadlines, urgent emails > 24h without response
- 🟡 **Warning**: Approaching deadlines (within 48h), pending reviews > 24h, high-priority unaddressed items
- 🔵 **Info**: Recent items worth noting, coming-up events, FYI messages

**Output format:**

```markdown
## ⚡ Highlights & Alerts

### 🔴 Critical (X items)
- **Overdue: [PROJ-42] Fix login bug** — Due 2 days ago, High priority [→ link]
- **Unanswered email** from CEO: "Q4 Budget Review" — Sent 36h ago [→ link]

### 🟡 Warning (X items)
- **Deadline tomorrow: [PROJ-55] API migration** — Due Feb 11 [→ link]

### 🔵 Info (X items)
- **New Slack mention** in #design by @carol — "Thoughts on the mockup?" [→ link]
- **Confluence update** Sprint Retro Notes — Modified 2h ago [→ link]
```
