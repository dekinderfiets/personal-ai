# Priority Queue

Build a prioritized queue of all pending items across all connectors.

## Purpose

Creates a comprehensive, ranked list of everything that needs the user's attention. Unlike `suggest_next_actions` (which picks the top 5), this skill produces the full backlog in priority order.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `sources` | No | Limit to specific sources (default: all) |
| `max_items` | No | Maximum items in the queue (default: 30) |

## Outputs

- Complete prioritized queue with all pending items

## Instructions

### Step 1: Get Current Time

Use the `time` tool to establish the current timestamp for age calculations.

### Step 2: Collect All Pending Items

Make these queries in parallel:

**All open Jira issues:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "open assigned in progress to do backlog",
    "sources": ["jira"],
    "searchType": "hybrid",
    "limit": 30
  }'
```

**All open GitHub items:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "open assigned pull request issue review",
    "sources": ["github"],
    "searchType": "hybrid",
    "where": { "state": "open" },
    "limit": 20
  }'
```

**Recent actionable emails:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "action required pending response todo follow up",
    "sources": ["gmail"],
    "searchType": "hybrid",
    "startDate": "<2_weeks_ago>",
    "limit": 20
  }'
```

**Unanswered Slack messages:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "question waiting response mention help needed",
    "sources": ["slack"],
    "searchType": "hybrid",
    "startDate": "<1_week_ago>",
    "limit": 20
  }'
```

**Upcoming deadlines:**
```bash
curl -X POST "${COLLECTOR_API_URL}/search" \
  -H "x-api-key: ${COLLECTOR_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "deadline due reminder",
    "sources": ["calendar", "jira"],
    "searchType": "hybrid",
    "startDate": "<today_start>",
    "endDate": "<1_week_from_now>",
    "limit": 20
  }'
```

### Step 3: Deduplicate and Score

1. Remove duplicates (same item appearing in multiple queries)
2. Score each item using the priority framework from `suggest_next_actions`:
   - Urgency (30%): Due dates, wait time
   - Importance (25%): Priority level, requester
   - Staleness (20%): Time since last update
   - Context Fit (15%): Relevance to today's schedule
   - Effort (10%): Quick-win bonus

### Step 4: Format Queue

```markdown
## 📊 Priority Queue (X items)

| # | Item | Source | Priority | Age | Effort |
|---|------|--------|----------|-----|--------|
| 1 | [PROJ-42] Fix login bug | Jira | 🔴 Critical | 5d | Deep |
| 2 | Reply to CEO email | Gmail | 🔴 High | 24h | Quick |
| 3 | PR #234 review | GitHub | 🟡 Medium | 28h | Quick |
| 4 | Answer @bob in #eng | Slack | 🟡 Medium | 12h | Quick |
| 5 | [PROJ-55] API migration | Jira | 🟡 Medium | 3d | Deep |
| ... | ... | ... | ... | ... | ... |

### Quick Wins (can do in <15 min)
- Reply to @bob in #engineering [→ link]
- Approve PR #234 [→ link]
- Reply to CEO email [→ link]

### Deep Work Items
- [PROJ-42] Fix login bug — estimated 2h [→ link]
- [PROJ-55] API migration — estimated 4h [→ link]
```
